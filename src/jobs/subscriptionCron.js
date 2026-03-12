import cron from 'node-cron';
import notificationService from '../services/notification.service.js';
import logger from '../config/log.js';
import Subscription from '../models/Subscription.js';
import UserSubscription from '../models/UserSubscription.js';
import Plan from '../models/Plan.js';

/**
 * Subscription Cron Job
 * Runs every 4 hours
 * - Sends renewal reminders (every 4 hours when 3 days are remaining)
 * - Expires subscriptions and blocks users
 */
class SubscriptionCron {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Start the cron job
   */
  start() {
    // Run every 4 hours
    // Cron format: minute hour day month weekday
    cron.schedule('0 */4 * * *', async () => {
      if (this.isRunning) {
        logger.warn('Subscription cron job already running, skipping this execution');
        return;
      }

      this.isRunning = true;
      logger.info('🕐 Starting subscription cron job...');

      try {
        await this.checkPreExpiryReminders();
        await this.checkExpiredSubscriptions();
        logger.info('✅ Subscription cron job completed successfully');
      } catch (error) {
        logger.error('❌ Subscription cron job failed:', error);
      } finally {
        this.isRunning = false;
      }
    }, {
      timezone: 'Asia/Kolkata'
    });

    logger.info('📅 Subscription cron job scheduled (Every 4 hours)');
  }

  /**
   * Check and send renewal reminders (every 4 hours when 3 days are remaining)
   */
  async checkPreExpiryReminders() {
    try {
      logger.info('📧 Checking for subscriptions expiring in 3 days (4-hour cadence)...');
      const renewalResult = await this.sendRenewalReminders();
      const demoResult = await this.sendDemoReminders();
      logger.info(`✅ Renewal reminder cycle completed. Renewal: ${renewalResult.sent}, Demo: ${demoResult.sent}`);
    } catch (error) {
      logger.error('Error in checkPreExpiryReminders:', error);
      throw error;
    }
  }

  async sendRenewalReminders(nowOverride = null) {
    const now = nowOverride || new Date();
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 3);
    let sent = 0;

    const shouldSend = (lastSentAt) => {
      if (!lastSentAt) return true;
      const diffMs = now.getTime() - new Date(lastSentAt).getTime();
      return diffMs >= 4 * 60 * 60 * 1000;
    };

    // Plan-based subscriptions
    const planSubs = await Subscription.find({
      status: 'active',
      endDate: { $gt: now, $lte: windowEnd }
    }).populate('user').populate('plan');

    for (const subscription of planSubs) {
      try {
        if (!subscription.user || !shouldSend(subscription.renewalReminderLastSentAt)) continue;
        const daysLeft = Math.ceil(
          (new Date(subscription.endDate) - now) / (1000 * 60 * 60 * 24)
        );
        await notificationService.sendPreExpiryReminder(subscription.user, subscription, daysLeft);
        subscription.renewalReminderLastSentAt = now;
        await subscription.save();
        sent += 1;
        logger.info(`✓ Renewal reminder sent to ${subscription.user.email} (${subscription.plan?.name || 'Plan'})`);
      } catch (error) {
        logger.error(`Failed to send renewal reminder for subscription ${subscription._id}:`, error);
      }
    }

    // Segment-based premium subscriptions
    const premiumSegmentSubs = await UserSubscription.find({
      status: 'active',
      is_active: true,
      plan_type: 'premium',
      end_date: { $gt: now, $lte: windowEnd }
    }).populate('user_id');

    for (const subscription of premiumSegmentSubs) {
      try {
        if (!subscription.user_id || !shouldSend(subscription.renewalReminderLastSentAt)) continue;
        const daysLeft = Math.ceil(
          (new Date(subscription.end_date) - now) / (1000 * 60 * 60 * 24)
        );
        const syntheticPlan = {
          _id: subscription._id,
          endDate: subscription.end_date,
          plan: { name: 'Premium Segments' }
        };
        await notificationService.sendPreExpiryReminder(subscription.user_id, syntheticPlan, daysLeft);
        subscription.renewalReminderLastSentAt = now;
        await subscription.save();
        sent += 1;
        logger.info(`✓ Renewal reminder sent to ${subscription.user_id.email || subscription.user_id._id}`);
      } catch (error) {
        logger.error(`Failed to send renewal reminder for segment subscription ${subscription._id}:`, error);
      }
    }

    return { sent };
  }

  async sendDemoReminders(nowOverride = null, options = {}) {
    const now = nowOverride || new Date();
    const windowDays = Number.isFinite(options.windowDays) ? options.windowDays : 1;
    const demoWindowEnd = new Date(now);
    demoWindowEnd.setDate(demoWindowEnd.getDate() + windowDays);
    let sent = 0;
    const forceSend = options.force === true;

    const demoPlans = await Plan.find({ isDemo: true }).select('_id').lean();
    const demoPlanIds = demoPlans.map((p) => p._id);

    const hasActivePaidPlan = async (userId) => {
      if (!userId) return false;
      const [paidPlan, paidSegment] = await Promise.all([
        Subscription.exists({
          user: userId,
          status: 'active',
          endDate: { $gt: now },
          ...(demoPlanIds.length > 0 ? { plan: { $nin: demoPlanIds } } : {})
        }),
        UserSubscription.exists({
          user_id: userId,
          status: 'active',
          is_active: true,
          plan_type: 'premium',
          end_date: { $gt: now },
        }),
      ]);
      return Boolean(paidPlan || paidSegment);
    };

    // Plan-based demo subscriptions
    const planDemoQuery = forceSend
      ? { status: 'active' }
      : { status: 'active', endDate: { $gt: now, $lte: demoWindowEnd } };
    const planDemoSubs = await Subscription.find(planDemoQuery).populate('user').populate('plan');

    for (const subscription of planDemoSubs) {
      try {
        if (!subscription.plan?.isDemo || !subscription.user) continue;
        if (!subscription.endDate || subscription.endDate <= now) continue;
        if (await hasActivePaidPlan(subscription.user._id)) continue;
        const daysLeft = subscription.endDate
          ? Math.ceil((new Date(subscription.endDate) - now) / (1000 * 60 * 60 * 24))
          : windowDays;
        await notificationService.sendDemoExpiryReminder(subscription.user, subscription, daysLeft);
        sent += 1;
        logger.info(`✓ Demo expiry reminder sent to ${subscription.user.email || subscription.user._id}`);
      } catch (error) {
        logger.error(`Failed to send demo expiry reminder for plan subscription ${subscription._id}:`, error);
      }
    }

    const demoSubs = await UserSubscription.find({
      status: 'active',
      is_active: true,
      plan_type: 'demo',
      ...(forceSend
        ? { end_date: { $gt: now } }
        : { end_date: { $gt: now, $lte: demoWindowEnd }, demoExpiryReminderSent: { $ne: true } })
    }).populate('user_id');

    for (const subscription of demoSubs) {
      try {
        if (!subscription.user_id) continue;
        if (!subscription.end_date || subscription.end_date <= now) continue;
        if (await hasActivePaidPlan(subscription.user_id)) continue;
        const daysLeft = subscription.end_date
          ? Math.ceil((new Date(subscription.end_date) - now) / (1000 * 60 * 60 * 24))
          : windowDays;
        await notificationService.sendDemoExpiryReminder(subscription.user_id, subscription, daysLeft);
        if (!forceSend) {
          subscription.demoExpiryReminderSent = true;
          subscription.demoExpiryReminderSentAt = now;
          await subscription.save();
        }
        sent += 1;
        logger.info(`✓ Demo expiry reminder sent to ${subscription.user_id.email || subscription.user_id._id}`);
      } catch (error) {
        logger.error(`Failed to send demo expiry reminder for segment subscription ${subscription._id}:`, error);
      }
    }

    return { sent };
  }

  async runRenewalRemindersNow() {
    logger.info('🔔 Manually triggering renewal reminders...');
    const result = await this.sendRenewalReminders();
    return { success: true, ...result };
  }

  async runDemoRemindersNow() {
    logger.info('🔔 Manually triggering demo reminders...');
    const result = await this.sendDemoReminders(null, { force: true, windowDays: 1 });
    return { success: true, ...result };
  }

  /**
   * Check and expire subscriptions that have passed their end date
   */
  async checkExpiredSubscriptions() {
    try {
      logger.info('🔒 Checking for expired subscriptions...');

      const now = new Date();
      const expiredSubscriptions = await Subscription.find({
        status: 'active',
        endDate: { $lte: now }
      }).populate('user').populate('plan');
      
      if (expiredSubscriptions.length === 0) {
        logger.info('No expired subscriptions found');
        return;
      }

      logger.info(`Found ${expiredSubscriptions.length} expired subscriptions`);

      for (const subscription of expiredSubscriptions) {
        try {
          const user = subscription.user;

          // Expire subscription and block user
          subscription.status = 'expired';
          await subscription.save();

          // Send expiry notification
          await notificationService.sendExpiryNotification(user, subscription);

          logger.info(`✓ Expired subscription and blocked user ${user.email} (${subscription.plan.name})`);
        } catch (error) {
          logger.error(`Failed to expire subscription ${subscription._id}:`, error);
        }
      }

      logger.info(`✅ Expired ${expiredSubscriptions.length} subscriptions and blocked users`);
    } catch (error) {
      logger.error('Error in checkExpiredSubscriptions:', error);
      throw error;
    }
  }

  /**
   * Manual trigger for testing (call this from admin panel or script)
   */
  async runManually() {
    logger.info('🔧 Manually triggering subscription cron job...');
    
    if (this.isRunning) {
      logger.warn('Subscription cron job already running');
      return { success: false, message: 'Job already running' };
    }

    this.isRunning = true;

    try {
      await this.checkPreExpiryReminders();
      await this.checkExpiredSubscriptions();
      
      this.isRunning = false;
      return { success: true, message: 'Subscription cron job completed successfully' };
    } catch (error) {
      this.isRunning = false;
      logger.error('Manual subscription cron job failed:', error);
      return { success: false, message: error.message };
    }
  }
}

export default new SubscriptionCron();

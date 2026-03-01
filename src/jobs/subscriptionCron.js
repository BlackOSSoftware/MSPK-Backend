import cron from 'node-cron';
import subscriptionService from '../services/subscription.service.js';
import notificationService from '../services/notification.service.js';
import logger from '../config/log.js';

/**
 * Subscription Cron Job
 * Runs daily at 9:00 AM IST
 * - Sends pre-expiry reminders (3 days before expiry)
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
    // Run every day at 9:00 AM IST (3:30 AM UTC)
    // Cron format: minute hour day month weekday
    cron.schedule('0 9 * * *', async () => {
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

    logger.info('📅 Subscription cron job scheduled (Daily at 9:00 AM IST)');
  }

  /**
   * Check and send pre-expiry reminders (3 days before expiry)
   */
  async checkPreExpiryReminders() {
    try {
      logger.info('📧 Checking for subscriptions expiring in 3 days...');
      
      const expiringSubscriptions = await subscriptionService.getExpiringSubscriptions(3);
      
      if (expiringSubscriptions.length === 0) {
        logger.info('No subscriptions expiring in 3 days');
        return;
      }

      logger.info(`Found ${expiringSubscriptions.length} subscriptions expiring in 3 days`);

      for (const subscription of expiringSubscriptions) {
        try {
          const user = subscription.user;
          const daysLeft = Math.ceil(
            (new Date(subscription.endDate) - new Date()) / (1000 * 60 * 60 * 24)
          );

          // Send pre-expiry reminder
          await notificationService.sendPreExpiryReminder(user, subscription, daysLeft);

          // Mark reminder as sent
          await subscriptionService.markPreExpiryReminderSent(subscription._id);

          logger.info(`✓ Pre-expiry reminder sent to ${user.email} (${subscription.plan.name})`);
        } catch (error) {
          logger.error(`Failed to send pre-expiry reminder for subscription ${subscription._id}:`, error);
        }
      }

      logger.info(`✅ Sent ${expiringSubscriptions.length} pre-expiry reminders`);
    } catch (error) {
      logger.error('Error in checkPreExpiryReminders:', error);
      throw error;
    }
  }

  /**
   * Check and expire subscriptions that have passed their end date
   */
  async checkExpiredSubscriptions() {
    try {
      logger.info('🔒 Checking for expired subscriptions...');
      
      const expiredSubscriptions = await subscriptionService.getExpiredSubscriptions();
      
      if (expiredSubscriptions.length === 0) {
        logger.info('No expired subscriptions found');
        return;
      }

      logger.info(`Found ${expiredSubscriptions.length} expired subscriptions`);

      for (const subscription of expiredSubscriptions) {
        try {
          const user = subscription.user;

          // Expire subscription and block user
          await subscriptionService.expireSubscription(subscription._id);

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

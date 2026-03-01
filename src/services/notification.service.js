import { Queue } from 'bullmq';
import config from '../config/config.js';
import logger from '../config/log.js';
import { redisSubscriber } from './redis.service.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Setting from '../models/Setting.js'; // Import Setting model

const connection = {
  host: config.redis.host,
  port: config.redis.port,
};

const notificationQueue = new Queue('notifications', { connection });

class NotificationService {
  constructor() {
    this.init();
  }

  init() {
    // Subscribe to signals channel from Redis
    // Note: redisSubscriber is shared, so we just add another listener
    redisSubscriber.on('message', (channel, message) => {
        if (channel === 'signals') {
            try {
                const signal = JSON.parse(message);
                this.scheduleNotifications(signal);
            } catch (err) {
                logger.error('Notification Service Error', err);
            }
        }
    });
    
    logger.info('Notification Service started (Listening for Signals)');
  }

  async scheduleNotifications(signal) {
      try {
          // Fetch Global Notification Settings
          const settings = await Setting.find({ 
              key: { $in: ['telegram_config', 'whatsapp_config', 'push_config'] } 
          });
          const getSetting = (key) => {
              const s = settings.find(s => s.key === key);
              return s ? s.value : null;
          };

          const teleConfig = getSetting('telegram_config');
          const waConfig = getSetting('whatsapp_config');
          const pushConfig = getSetting('push_config');

          // 1. TELEGRAM BROADCAST (System Level)
          if (teleConfig && teleConfig.enabled) {
              await notificationQueue.add('send-telegram-broadcast', {
                  type: 'telegram',
                  signal,
                  userId: 'system' 
              }, { removeOnComplete: true });
          }

          // 2. TARGETED NOTIFICATIONS (WhatsApp / Push)
          // Find users with Active Subscriptions matching this Segment
          
          // Step A: Find Plans that cover this segment
          // Note: Plan schema uses 'segment' enum. Signal has 'segment' field.
          // Adjust matching logic if segment names differ. Assuming exact match for now.
          const { default: Subscription } = await import('../models/Subscription.js');
          const { default: Plan } = await import('../models/Plan.js');

          // Find active subscriptions
          const now = new Date();
          const activeSubs = await Subscription.find({
              status: 'active',
              endDate: { $gt: now }
          }).populate('plan');

          // Filter for segment match
          const eligibleUserIds = new Set();
          
          activeSubs.forEach(sub => {
              if (sub.plan && sub.user) {
                  // Direct Segment Match
                  if (sub.plan.segment === signal.segment) {
                      eligibleUserIds.add(sub.user.toString());
                  }
                  // TODO: Handle 'All Segments' plans if any
              }
          });

          // Also include the Creator for verification (if not already included)
          if (signal.createdBy) eligibleUserIds.add(signal.createdBy.toString());

          logger.info(`Found ${eligibleUserIds.size} eligible users for Signal ${signal.symbol}`);

          // Step B: Schedule Jobs for each user
          const promises = Array.from(eligibleUserIds).map(userId => {
              const jobs = [];

              if (pushConfig && pushConfig.enabled) {
                  jobs.push(notificationQueue.add('send-push', {
                      type: 'push',
                      userId,
                      signal
                  }, { removeOnComplete: true }));
              }

              if (waConfig && waConfig.enabled) {
                  jobs.push(notificationQueue.add('send-whatsapp', {
                      type: 'whatsapp',
                      userId,
                      signal
                  }, { removeOnComplete: true }));
              }
              
              return jobs;
          });

          await Promise.all(promises.flat());
          

          // Step C: Create In-App Notifications (DB)
          // Only if Push/System notifications are enabled
          if (pushConfig && pushConfig.enabled) {
              const tpDetails = [
                  signal.targets?.target1 ? `TP1: ${signal.targets.target1}` : null,
                  signal.targets?.target2 ? `TP2: ${signal.targets.target2}` : null,
                  signal.targets?.target3 ? `TP3: ${signal.targets.target3}` : null
              ].filter(t => t).join(' | ');

              const notificationDocs = Array.from(eligibleUserIds).map(userId => ({
                  user: userId,
                  title: `🚀 New Signal: ${signal.symbol}`,
                  message: `Action: ${signal.type} | Entry: ${signal.entryPrice}\n${tpDetails}\nSL: ${signal.stopLoss}`,
                  type: 'SIGNAL',
                  data: { signalId: signal._id },
                  link: `/signals` 
              }));

              if (notificationDocs.length > 0) {
                  await Notification.insertMany(notificationDocs);
              }
          }

          logger.info(`Scheduled notifications for Signal ${signal._id} to ${eligibleUserIds.size} users`);

      } catch (error) {
          logger.error('Failed to schedule notifications', error);
      }
  }

  async scheduleAnnouncementNotifications(announcement) {
      try {
          const { targetAudience, title, message } = announcement;
          const query = { status: 'Active' };

          // 1. Audience Filtering by Role
          if (targetAudience && targetAudience.role !== 'all') {
             query.role = targetAudience.role;
          }

          // 2. Advanced Targeting (Plans / Segments)
          if (targetAudience && (targetAudience.planValues?.length > 0 || targetAudience.segments?.length > 0)) {
              const { default: Subscription } = await import('../models/Subscription.js');
              const { default: Plan } = await import('../models/Plan.js');

              const eligiblePlansFilter = { $or: [] };
              if (targetAudience.planValues?.length > 0) {
                  eligiblePlansFilter.$or.push({ name: { $in: targetAudience.planValues } });
              }
              if (targetAudience.segments?.length > 0) {
                  // Check direct segment OR specific permissions (most sub-categories are in permissions)
                  eligiblePlansFilter.$or.push({ segment: { $in: targetAudience.segments } });
                  eligiblePlansFilter.$or.push({ permissions: { $in: targetAudience.segments } });
              }

              const eligiblePlans = await Plan.find(eligiblePlansFilter).select('_id');
              const eligiblePlanIds = eligiblePlans.map(p => p._id);

              if (eligiblePlanIds.length > 0) {
                  const now = new Date();
                  const activeSubs = await Subscription.find({
                      status: 'active',
                      endDate: { $gt: now },
                      plan: { $in: eligiblePlanIds }
                  }).select('user');
                  
                  const userIdsFromSubs = Array.from(new Set(activeSubs.map(s => s.user.toString())));
                  query._id = { $in: userIdsFromSubs };
              } else {
                  logger.info('No matching plans found for targeting filters');
                  return;
              }
          }

          // LOGGING FOR DEBUG
          console.log('[DEBUG-LIVE] Target Audience:', JSON.stringify(targetAudience));
          console.log('[DEBUG-LIVE] Generated Query:', JSON.stringify(query));

          const users = await User.find(query).select('_id name fcmTokens phone phoneNumber');
          
          console.log(`[DEBUG-LIVE] Users Found: ${users.length}`);

          if (users.length === 0) {
              logger.info('[DEBUG-LIVE] No users found for announcement broadcast matching filters');
              return;
          }

          logger.info(`[DEBUG-LIVE] Scheduling announcement broadcast for ${users.length} users`);

          // 0. Telegram Channel Broadcast (One time)
          // We assume this is a general announcement for the public channel
          await notificationQueue.add('send-telegram-broadcast', {
              type: 'telegram',
              userId: 'system',
              announcement: { title, message }
          }, { removeOnComplete: true });

          const promises = users.map(user => {
              const jobs = [];
              
              // 1. Push Job
              if (user.fcmTokens && user.fcmTokens.length > 0) {
                  jobs.push(notificationQueue.add('send-push-announcement', {
                      type: 'push',
                      userId: user._id,
                      announcement: announcement.toObject ? announcement.toObject() : announcement // Ensure plain object
                  }, { removeOnComplete: true }));
              }

              // 2. WhatsApp Job
              // Only if user has phone. In production, check consent/settings too.
              // Note: This can generate A LOT of jobs. Bulk APIs are preferred but per-user job is safer for rate limiting in worker.
              if (user.phone || user.phoneNumber) { // Check schema field
                   jobs.push(notificationQueue.add('send-whatsapp-announcement', {
                      type: 'whatsapp',
                      userId: user._id, // Worker will fetch user to get phone
                      announcement: announcement.toObject ? announcement.toObject() : announcement
                   }, { removeOnComplete: true }));
              }

              return Promise.all(jobs);
          });

          await Promise.all(promises);

          // Save In-App Notifications
          const notificationDocs = users.map(user => ({
              user: user._id,
              title: title,
              message: message,
              type: 'ANNOUNCEMENT',
              isRead: false
          }));

          if (notificationDocs.length > 0) {
              await Notification.insertMany(notificationDocs);
          }

          logger.info(`Broadcasted announcement ${announcement._id} to ${users.length} potential users`);

      } catch (error) {
          logger.error('Failed to schedule announcement notifications', error);
      }
  }
  /**
   * Send pre-expiry reminder (3 days before expiry)
   * @param {Object} user - User object
   * @param {Object} subscription - Subscription object
   * @param {Number} daysLeft - Days until expiry
   */
  async sendPreExpiryReminder(user, subscription, daysLeft) {
      try {
          const planName = subscription.plan?.name || 'Subscription';
          const expiryDate = new Date(subscription.endDate).toLocaleDateString('en-IN');
          
          // 1. Send Push Notification
          if (user.fcmTokens && user.fcmTokens.length > 0) {
              await notificationQueue.add('send-push-reminder', {
                  type: 'push',
                  userId: user._id,
                  notification: {
                      title: '⏰ Subscription Expiring Soon',
                      message: `Your ${planName} plan expires in ${daysLeft} days (${expiryDate}). Renew now to continue enjoying our services!`,
                      type: 'SUBSCRIPTION_EXPIRY_REMINDER',
                      data: {
                          subscriptionId: subscription._id,
                          planName,
                          daysLeft,
                          expiryDate
                      }
                  }
              }, { removeOnComplete: true });
          }

          // 2. Send Email Notification
          await notificationQueue.add('send-email', {
              type: 'email',
              userId: user._id,
              email: user.email,
              subject: `⏰ Your ${planName} Plan Expires in ${daysLeft} Days`,
              template: 'pre-expiry-reminder',
              data: {
                  userName: user.name,
                  planName,
                  daysLeft,
                  expiryDate,
                  renewLink: `${config.frontendUrl}/renew-subscription`
              }
          }, { removeOnComplete: true });

          // 3. Create In-App Notification
          await Notification.create({
              user: user._id,
              title: '⏰ Subscription Expiring Soon',
              message: `Your ${planName} plan expires in ${daysLeft} days. Renew now!`,
              type: 'SUBSCRIPTION_REMINDER',
              data: { subscriptionId: subscription._id },
              link: '/subscription'
          });

          logger.info(`Pre-expiry reminder sent to user ${user._id} for subscription ${subscription._id}`);

      } catch (error) {
          logger.error(`Failed to send pre-expiry reminder for user ${user._id}`, error);
      }
  }

  /**
   * Send expiry notification (when subscription has expired)
   * @param {Object} user - User object
   * @param {Object} subscription - Subscription object
   */
  async sendExpiryNotification(user, subscription) {
      try {
          const planName = subscription.plan?.name || 'Subscription';
          
          // 1. Send Push Notification
          if (user.fcmTokens && user.fcmTokens.length > 0) {
              await notificationQueue.add('send-push-reminder', {
                  type: 'push',
                  userId: user._id,
                  notification: {
                      title: '🔒 Subscription Expired',
                      message: `Your ${planName} plan has expired. Your account access has been restricted. Renew now to regain access!`,
                      type: 'SUBSCRIPTION_EXPIRED',
                      data: {
                          subscriptionId: subscription._id,
                          planName
                      }
                  }
              }, { removeOnComplete: true });
          }

          // 2. Send Email Notification
          await notificationQueue.add('send-email', {
              type: 'email',
              userId: user._id,
              email: user.email,
              subject: `🔒 Your ${planName} Plan Has Expired`,
              template: 'subscription-expired',
              data: {
                  userName: user.name,
                  planName,
                  renewLink: `${config.frontendUrl}/renew-subscription`
              }
          }, { removeOnComplete: true });

          // 3. Create In-App Notification
          await Notification.create({
              user: user._id,
              title: '🔒 Subscription Expired',
              message: `Your ${planName} plan has expired. Renew to regain access.`,
              type: 'SUBSCRIPTION_EXPIRED',
              data: { subscriptionId: subscription._id },
              link: '/subscription'
          });

          logger.info(`Expiry notification sent to user ${user._id} for subscription ${subscription._id}`);

      } catch (error) {
          logger.error(`Failed to send expiry notification for user ${user._id}`, error);
      }
  }

  /**
   * Send Economic Event Alert to All Active Users
   * @param {Object} economicEvent - Economic event data
   */
  async sendEconomicAlert(economicEvent) {
      try {
          logger.info(`Sending economic alert for: ${economicEvent.event} (${economicEvent.impact} impact)`);

          // Get all users with ACTIVE and VALID Subscription
          const { default: Subscription } = await import('../models/Subscription.js');
          
          const now = new Date();
          const activeSubs = await Subscription.find({
              status: 'active',
              endDate: { $gt: now }
          }).select('user');

          if (activeSubs.length === 0) {
              logger.warn('No active subscriptions found for economic alert');
              return;
          }

          const userIds = [...new Set(activeSubs.map(s => s.user.toString()))];
          
          // Fetch Users to get FCM tokens
          const activeUsers = await User.find({
              _id: { $in: userIds },
              status: 'Active' // Double check user is valid
          }).select('_id name email fcmTokens');

          // Format event time
          const eventDate = new Date(economicEvent.date);
          const timeStr = eventDate.toLocaleString('en-IN', { 
              dateStyle: 'medium', 
              timeStyle: 'short',
              timeZone: 'Asia/Kolkata'
          });

          // Create notification title and message
          const impactEmoji = economicEvent.impact === 'High' ? '🔴' : '🟡';
          const title = `${impactEmoji} ${economicEvent.impact} Impact Economic Event`;
          const message = `${economicEvent.event} (${economicEvent.currency}) - ${timeStr}`;
          
          // Prepare notification data
          const notificationData = {
              event: economicEvent.event,
              country: economicEvent.country,
              currency: economicEvent.currency,
              impact: economicEvent.impact,
              date: economicEvent.date,
              actual: economicEvent.actual || 'N/A',
              forecast: economicEvent.forecast || 'N/A',
              previous: economicEvent.previous || 'N/A'
          };

          // 0. Create Broadcast Record
          try {
              const { default: announcementService } = await import('./announcement.service.js');
              await announcementService.createAnnouncement({
                  title,
                  message,
                  type: 'ECONOMIC',
                  priority: economicEvent.impact === 'High' ? 'HIGH' : 'NORMAL',
                  targetAudience: { role: 'all' },
                  isActive: true,
                  startDate: new Date()
              });
          } catch (announcementError) {
              logger.error('Failed to create announcement for economic alert', announcementError);
          }

          // Send to all users
          for (const user of activeUsers) {
              try {
                  // 1. Send Push Notification
                  await notificationQueue.add('send-push', {
                      type: 'push',
                      userId: user._id,
                      notification: {
                          title,
                          message,
                          type: 'ECONOMIC_ALERT',
                          data: notificationData
                      }
                  }, { removeOnComplete: true });

                  // 2. Create In-App Notification
                  await Notification.create({
                      user: user._id,
                      title,
                      message,
                      type: 'ECONOMIC_ALERT',
                      data: notificationData,
                      link: '/announcements/calendar'
                  });

              } catch (userError) {
                  logger.error(`Failed to send alert to user ${user._id}:`, userError.message);
              }
          }

          logger.info(`Economic alert sent successfully to ${activeUsers.length} users`);

      } catch (error) {
          logger.error('Failed to send economic alert:', error);
      }
  }

  /**
   * Legacy function - keeping for backward compatibility
   */
  async sendPlanExpiryReminder(user, daysLeft) {
      try {
          const planName = user.subscription?.plan?.name || 'Subscription';
          
          await notificationQueue.add('send-push-reminder', {
              type: 'push',
              userId: user._id,
              announcement: {
                  type: 'REMINDER',
                  planName,
                  daysLeft,
                  title: 'Plan Expiry',
                  message: `Your ${planName} plan expires in ${daysLeft} days.`
              }
          }, { removeOnComplete: true });

      } catch (error) {
          logger.error(`Failed to schedule expiry reminder for user ${user._id}`, error);
      }
  }
}

export default new NotificationService();

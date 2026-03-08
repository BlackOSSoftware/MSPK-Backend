import config from '../config/config.js';
import logger from '../config/log.js';
import { redisSubscriber } from './redis.service.js';
import '../models/Plan.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import MasterSymbol from '../models/MasterSymbol.js';
import Setting from '../models/Setting.js'; // Import Setting model
import notificationQueue from './notificationQueue.js';
import {
  getSignalAudienceGroups,
  hasAudienceOverlap,
  mapPreferredSegmentsToAudienceGroups,
  mapUserSubscriptionSegmentsToAudienceGroups,
} from '../utils/signalRouting.js';
import templates from '../config/notificationTemplates.js';
import whatsappChannelService from './channels/whatsapp.service.js';
import {
  buildSignalTemplateData,
  getSignalTemplateKey,
  renderNotificationTemplate,
} from '../utils/notificationFormatter.js';
import {
  buildSelectedSymbolDocsMap,
  getUserSelectedSymbols,
  hasSelectedSignalSymbol,
} from '../utils/userSignalSelection.js';
import { sendToUser } from './websocket.service.js';

const serializeRealtimeNotification = (notification) => ({
  _id: notification._id,
  title: notification.title,
  message: notification.message,
  type: notification.type,
  isRead: notification.isRead,
  data: notification.data || {},
  link: notification.link || null,
  createdAt: notification.createdAt,
  updatedAt: notification.updatedAt,
});

const emitRealtimeNotifications = (notificationDocs = []) => {
  notificationDocs.forEach((notification) => {
    if (!notification?.user) return;
    sendToUser(String(notification.user), {
      type: 'notification:new',
      payload: serializeRealtimeNotification(notification),
    });
  });
};

const yieldToEventLoop = () =>
  new Promise((resolve) => {
    if (global.setImmediate) {
      setImmediate(resolve);
      return;
    }
    setTimeout(resolve, 0);
  });

class NotificationService {
  constructor() {
    this.init();
  }

  init() {
    // Ensure we are actually subscribed to the channel we claim to listen to.
    redisSubscriber.subscribe('signals', (err) => {
      if (err) logger.error('Failed to subscribe to signals channel', err);
    });

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
              key: { $in: ['telegram_config', 'whatsapp_config', 'push_config', 'email_config', 'notification_templates'] } 
          });
          const getSetting = (key) => {
              const s = settings.find(s => s.key === key);
              return s ? s.value : null;
          };

          const teleConfig = getSetting('telegram_config');
          const waConfig = getSetting('whatsapp_config');
          const pushConfig = getSetting('push_config');
          const emailConfig = getSetting('email_config');
          const activeTemplates = { ...templates, ...(getSetting('notification_templates') || {}) };
          const whatsappEnabled = whatsappChannelService.isConfigured(waConfig);

          // 1. TARGETED NOTIFICATIONS (Telegram / WhatsApp / Push)
          // Find users with Active Subscriptions matching this Segment
          
          // Step A: Find Plans that cover this segment (segment groups derived from plan permissions)
          const { default: Subscription } = await import('../models/Subscription.js');
          const { default: UserSubscription } = await import('../models/UserSubscription.js');
          const { default: authService } = await import('./auth.service.js');

          // Find active subscriptions
          const now = new Date();
          const activeSubs = await Subscription.find({
              status: 'active',
              endDate: { $gt: now }
          }).populate('plan');

          const activeSegmentSubs = await UserSubscription.find({
              status: 'active',
              is_active: true,
              end_date: { $gt: now }
          }).select('user_id segments');
          const signalAudienceGroups = getSignalAudienceGroups(signal);

          // Filter for segment match
          const candidateUserIds = new Set();
          
          activeSubs.forEach(sub => {
              if (sub.plan && sub.user) {
                  const planSegmentsFromPerms = Array.isArray(sub.plan.permissions) && sub.plan.permissions.length > 0
                      ? authService.getSegmentsFromPermissions(sub.plan.permissions)
                      : [];

                  const planSegmentGroups = planSegmentsFromPerms.length > 0
                      ? planSegmentsFromPerms
                      : (sub.plan.segment ? [sub.plan.segment] : []);

                  if (
                      signalAudienceGroups.length === 0 ||
                      hasAudienceOverlap(planSegmentGroups, signalAudienceGroups)
                  ) {
                      candidateUserIds.add(sub.user.toString());
                  }
              }
          });

          activeSegmentSubs.forEach((sub) => {
              if (!sub.user_id) return;
              const subscriptionGroups = mapUserSubscriptionSegmentsToAudienceGroups(sub.segments);
              if (
                  signalAudienceGroups.length === 0 ||
                  hasAudienceOverlap(subscriptionGroups, signalAudienceGroups)
              ) {
                  candidateUserIds.add(sub.user_id.toString());
              }
          });

          // Also include the Creator for verification (if not already included)
          const createdById = signal.createdBy ? signal.createdBy.toString() : null;
          if (createdById) candidateUserIds.add(createdById);

          const candidateIds = Array.from(candidateUserIds);
          const users = candidateIds.length > 0
              ? await User.find({
                    _id: { $in: candidateIds },
                    status: 'Active'
                }).select('_id name email role fcmTokens phone phoneNumber preferredSegments marketWatchlist isNotificationEnabled isWhatsAppEnabled isEmailAlertEnabled telegramChatId telegramUsername')
              : [];
          const allSelectedSymbols = users.flatMap((user) => getUserSelectedSymbols(user));
          const selectedSymbolDocs = allSelectedSymbols.length > 0
              ? await MasterSymbol.find({ symbol: { $in: allSelectedSymbols } }).select('symbol segment exchange').lean()
              : [];
          const selectedSymbolDocsMap = buildSelectedSymbolDocsMap(selectedSymbolDocs);

          const eligibleUsers = users.filter((user) => {
              const isPrivilegedCreator =
                  createdById &&
                  user._id.toString() === createdById &&
                  user.role !== 'user';

              if (!isPrivilegedCreator) {
                  const selectedSymbols = getUserSelectedSymbols(user, selectedSymbolDocsMap);
                  if (!hasSelectedSignalSymbol(selectedSymbols, signal.symbol)) {
                      return false;
                  }
              }

              if (signalAudienceGroups.length === 0) return true;

              const preferredGroups = mapPreferredSegmentsToAudienceGroups(user.preferredSegments);
              if (preferredGroups.length === 0) return true;

              return hasAudienceOverlap(preferredGroups, signalAudienceGroups);
          });

          const emailEnabled = emailConfig ? emailConfig.enabled !== false : true;

          logger.info(`Found ${eligibleUsers.length} eligible users for Signal ${signal.symbol}`);

          // Step B: Schedule Jobs for each user
          const promises = eligibleUsers.map((user) => {
              const jobs = [];
              const userId = user._id.toString();

              if (
                  (teleConfig ? teleConfig.enabled !== false : Boolean(process.env.TELEGRAM_BOT_TOKEN)) &&
                  user.isNotificationEnabled !== false &&
                  user.telegramChatId
              ) {
                  jobs.push(notificationQueue.add('send-telegram', {
                      type: 'telegram',
                      userId,
                      signal
                  }, { removeOnComplete: true }));
              }

              if (pushConfig && pushConfig.enabled && user.isNotificationEnabled !== false) {
                  jobs.push(notificationQueue.add('send-push', {
                      type: 'push',
                      userId,
                      signal
                  }, { removeOnComplete: true }));
              }

              if (
                  whatsappEnabled &&
                  user.isWhatsAppEnabled !== false &&
                  (user.phoneNumber || user.phone)
              ) {
                  jobs.push(notificationQueue.add('send-whatsapp', {
                      type: 'whatsapp',
                      userId,
                      signal
                  }, { removeOnComplete: true }));
              }

              if (emailEnabled && user.isEmailAlertEnabled !== false && user.email) {
                  jobs.push(notificationQueue.add('send-email-signal', {
                      type: 'email',
                      userId,
                      email: user.email,
                      signal
                  }, { removeOnComplete: true }));
              }
              
              return jobs;
          });

          await Promise.all(promises.flat());
          

          // Step C: Create In-App Notifications (DB)
          // In-app notifications should not depend on push settings.
          const signalTemplateKey = getSignalTemplateKey(signal);
          const signalTemplateData = buildSignalTemplateData(signal);
          const renderedSignalNotification = renderNotificationTemplate(
              activeTemplates,
              signalTemplateKey,
              signalTemplateData
          );

          const notificationDocs = eligibleUsers.map((user) => ({
              user: user._id,
              title: renderedSignalNotification.title,
              message: renderedSignalNotification.body,
              type: 'SIGNAL',
              data: { signalId: signal._id },
              link: `/signals` 
          }));

          if (notificationDocs.length > 0) {
              const createdNotifications = await Notification.insertMany(notificationDocs);
              emitRealtimeNotifications(createdNotifications);
          }


          logger.info(`Scheduled notifications for Signal ${signal._id} to ${eligibleUsers.length} users`);

      } catch (error) {
          logger.error('Failed to schedule notifications', error);
      }
  }

  async scheduleAnnouncementNotifications(announcement) {
      try {
          const { targetAudience, title, message } = announcement;
          const query = { status: 'Active' };
          const debugLive = process.env.DEBUG_LIVE === 'true';
          const waSetting = await Setting.findOne({ key: 'whatsapp_config' }).lean();
          const whatsappEnabled = whatsappChannelService.isConfigured(waSetting?.value || null);

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
                  }).select('user').lean();
                  
                  const userIdsFromSubs = Array.from(new Set(activeSubs.map(s => s.user.toString())));
                  query._id = { $in: userIdsFromSubs };
              } else {
                  logger.info('No matching plans found for targeting filters');
                  return;
              }
          }

          if (debugLive) {
              logger.debug(`[DEBUG-LIVE] Target Audience: ${JSON.stringify(targetAudience)}`);
              logger.debug(`[DEBUG-LIVE] Generated Query: ${JSON.stringify(query)}`);
          }

          const users = await User.find(query).select('_id name phone phoneNumber').lean();
          
          if (debugLive) {
              logger.debug(`[DEBUG-LIVE] Users Found: ${users.length}`);
          }

          if (users.length === 0) {
              logger.info('No users found for announcement broadcast matching filters');
              return;
          }

          logger.info(`Scheduling announcement broadcast for ${users.length} users`);

          // 0. Telegram Channel Broadcast (One time)
          // We assume this is a general announcement for the public channel
          await notificationQueue.add('send-telegram-broadcast', {
              type: 'telegram',
              userId: 'system',
              announcement: { title, message }
          }, { removeOnComplete: true });

          const safeAnnouncement = announcement.toObject ? announcement.toObject() : announcement;
          const JOB_BATCH_SIZE = 200;
          for (let index = 0; index < users.length; index += JOB_BATCH_SIZE) {
              const batch = users.slice(index, index + JOB_BATCH_SIZE);
              const jobs = [];

              for (const user of batch) {
                  // 1. Push Job
                  jobs.push(notificationQueue.add('send-push-announcement', {
                      type: 'push',
                      userId: user._id,
                      announcement: safeAnnouncement
                  }, { removeOnComplete: true }));

                  // 2. WhatsApp Job
                  if (whatsappEnabled && (user.phone || user.phoneNumber)) {
                      jobs.push(notificationQueue.add('send-whatsapp-announcement', {
                          type: 'whatsapp',
                          userId: user._id,
                          announcement: safeAnnouncement
                      }, { removeOnComplete: true }));
                  }
              }

              await Promise.allSettled(jobs);
              await yieldToEventLoop();
          }

          // Save In-App Notifications
          const notificationDocs = users.map(user => ({
              user: user._id,
              title: title,
              message: message,
              type: 'ANNOUNCEMENT',
              isRead: false
          }));

          if (notificationDocs.length > 0) {
              const createdNotifications = await Notification.insertMany(notificationDocs);
              emitRealtimeNotifications(createdNotifications);
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
          const notification = await Notification.create({
              user: user._id,
              title: '⏰ Subscription Expiring Soon',
              message: `Your ${planName} plan expires in ${daysLeft} days. Renew now!`,
              type: 'SUBSCRIPTION_REMINDER',
              data: { subscriptionId: subscription._id },
              link: '/subscription'
          });
          emitRealtimeNotifications([notification]);

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
          const notification = await Notification.create({
              user: user._id,
              title: '🔒 Subscription Expired',
              message: `Your ${planName} plan has expired. Renew to regain access.`,
              type: 'SUBSCRIPTION_EXPIRED',
              data: { subscriptionId: subscription._id },
              link: '/subscription'
          });
          emitRealtimeNotifications([notification]);

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
          }).select('user').lean();

          if (activeSubs.length === 0) {
              logger.warn('No active subscriptions found for economic alert');
              return;
          }

          const userIds = [...new Set(activeSubs.map(s => s.user.toString()))];
          
          // Fetch Users to get FCM tokens
          const activeUsers = await User.find({
              _id: { $in: userIds },
              status: 'Active' // Double check user is valid
          }).select('_id name email').lean();

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

          // Send push jobs in controlled batches
          const PUSH_BATCH_SIZE = 200;
          for (let index = 0; index < activeUsers.length; index += PUSH_BATCH_SIZE) {
              const batch = activeUsers.slice(index, index + PUSH_BATCH_SIZE);
              const jobs = batch.map((user) => notificationQueue.add('send-push', {
                  type: 'push',
                  userId: user._id,
                  notification: {
                      title,
                      message,
                      type: 'ECONOMIC_ALERT',
                      data: notificationData
                  }
              }, { removeOnComplete: true }));

              await Promise.allSettled(jobs);
              await yieldToEventLoop();
          }

          // Save in-app notifications in bulk
          const notificationDocs = activeUsers.map((user) => ({
              user: user._id,
              title,
              message,
              type: 'ECONOMIC_ALERT',
              data: notificationData,
              link: '/announcements/calendar'
          }));

          if (notificationDocs.length > 0) {
              const createdNotifications = await Notification.insertMany(notificationDocs, { ordered: false });
              emitRealtimeNotifications(createdNotifications);
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

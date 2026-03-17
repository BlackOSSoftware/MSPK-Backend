import config from '../config/config.js';
import crypto from 'crypto';
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
import { derivePlanPermissions } from '../utils/planPermissions.js';
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

const hashKey = (value) =>
  crypto.createHash('sha1').update(String(value ?? '')).digest('hex');

const normalizeEventTime = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
};

const normalizeIdentifier = (value) => {
  if (!value) return '';
  if (typeof value === 'object' && value.$oid) return String(value.$oid);
  return String(value);
};

const buildSignalEventKey = (signal = {}) => {
  const subType = String(signal?.subType || 'SIGNAL_NEW').trim().toUpperCase();
  const primaryId = signal?._id || signal?.id || signal?.uniqueId;
  const baseId = primaryId
    ? normalizeIdentifier(primaryId)
    : [
        signal?.symbol,
        signal?.segment,
        signal?.timeframe,
        signal?.type,
        signal?.entryPrice,
      ]
        .filter((value) => value !== undefined && value !== null)
        .join('|');

  const eventTime =
    signal?.exitTime ||
    signal?.updatedAt ||
    signal?.signalTime ||
    signal?.createdAt ||
    '';

  return `SIGNAL|${subType}|${String(baseId || '').trim()}|${normalizeEventTime(eventTime)}`;
};

const buildNotificationDedupKey = (signalEventKey, userId) =>
  `SIG|${hashKey(`${signalEventKey}|${userId}`)}`;

const buildJobId = (signalEventKey, userId, channel) =>
  `sig_${hashKey(`${signalEventKey}|${userId}|${channel}`)}`;

const isJobExistsError = (error) =>
  error?.name === 'JobExistsError' ||
  error?.code === 'ERR_JOB_EXISTS' ||
  /already exists/i.test(error?.message || '');

const addJobsInBatches = async (jobs, batchSize = 200) => {
  let added = 0;
  let skipped = 0;
  let failed = 0;
  const failureSamples = [];

  for (let index = 0; index < jobs.length; index += batchSize) {
    const batch = jobs.slice(index, index + batchSize);
    const results = await Promise.allSettled(
      batch.map((job) => notificationQueue.add(job.name, job.data, job.opts))
    );

    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        added += 1;
        return;
      }
      if (isJobExistsError(result.reason)) {
        skipped += 1;
        return;
      }
      failed += 1;
      if (failureSamples.length < 5) {
        const err = result.reason;
        failureSamples.push({
          name: batch[idx]?.name,
          code: err?.code || err?.name || 'UNKNOWN',
          message: err?.message || String(err),
        });
      }
    });

    await yieldToEventLoop();
  }

  return { added, skipped, failed, failureSamples };
};

const mapLegacyPlanToAudienceGroups = (planName = '') => {
  const normalized = String(planName || '').trim().toUpperCase();
  if (!normalized || normalized === 'FREE') return [];

  const groups = new Set();
  if (normalized.includes('ALL') || normalized.includes('PREMIUM') || normalized.includes('PRO')) {
    groups.add('ALL');
  }
  if (normalized.includes('EQUITY') || normalized.includes('NSE')) groups.add('EQUITY');
  if (normalized.includes('OPTION') || normalized.includes('FNO')) groups.add('FNO');
  if (normalized.includes('COMMODITY') || normalized.includes('MCX')) groups.add('COMMODITY');
  if (normalized.includes('FOREX') || normalized.includes('CURRENCY')) groups.add('CURRENCY');
  if (normalized.includes('CRYPTO')) groups.add('CRYPTO');

  if (groups.size === 0) {
    // Legacy plan names often imply full access (ex: "Premium"). Be permissive here.
    groups.add('ALL');
  }

  return Array.from(groups);
};

const derivePlanSegments = (plan, authService) => {
  if (!plan) return [];
  const permissions = derivePlanPermissions(plan);
  const segmentsFromPerms = authService.getSegmentsFromPermissions(permissions);
  if (segmentsFromPerms.length > 0) return segmentsFromPerms;

  if (Array.isArray(plan.segments) && plan.segments.length > 0) {
    const normalizedSegments = plan.segments
      .map((segment) => String(segment || '').trim().toUpperCase())
      .filter(Boolean);
    if (normalizedSegments.length > 0) return normalizedSegments;
  }

  if (plan.segment) {
    const normalized = String(plan.segment || '').trim().toUpperCase();
    if (normalized) return [normalized];
  }

  const name = String(plan.name || '').trim().toUpperCase();
  if (!name) return [];

  if (name.includes('ALL') || name.includes('PREMIUM') || name.includes('PRO')) {
    return ['ALL'];
  }

  return [];
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
    this.signalQueue = [];
    this.activeSignalTasks = 0;
    const concurrency = Number.isFinite(config.notifications?.signalConcurrency)
      ? config.notifications.signalConcurrency
      : 10;
    this.signalConcurrency = Math.max(concurrency, 1);
    this.settingsCache = { value: null, expiresAt: 0 };
    this.settingsCacheMs = Number.isFinite(config.notifications?.settingsCacheMs)
      ? Math.max(config.notifications.settingsCacheMs, 0)
      : 15000;
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
                this.enqueueSignal(signal);
            } catch (err) {
                logger.error('Notification Service Error', err);
            }
        }
    });
    
    logger.info('Notification Service started (Listening for Signals)');
  }

  enqueueSignal(signal) {
    this.signalQueue.push(signal);
    this.drainSignalQueue();
  }

  drainSignalQueue() {
    while (this.activeSignalTasks < this.signalConcurrency && this.signalQueue.length > 0) {
      const signal = this.signalQueue.shift();
      this.activeSignalTasks += 1;
      this.scheduleNotifications(signal)
        .catch((error) => logger.error('Failed to process queued signal notification', error))
        .finally(() => {
          this.activeSignalTasks -= 1;
          this.drainSignalQueue();
        });
    }
  }

  async getSettings() {
    const now = Date.now();
    if (this.settingsCacheMs > 0 && this.settingsCache.value && this.settingsCache.expiresAt > now) {
      return this.settingsCache.value;
    }

    const settings = await Setting.find({
      key: { $in: ['telegram_config', 'whatsapp_config', 'push_config', 'email_config', 'notification_templates'] }
    }).lean();

    this.settingsCache = {
      value: settings,
      expiresAt: now + this.settingsCacheMs,
    };

    return settings;
  }

  async scheduleNotifications(signal) {
      try {
          const debugBroadcastAll =
              String(process.env.DEBUG_SIGNAL_BROADCAST_ALL || '').trim().toLowerCase() === 'true';

          // Fetch Global Notification Settings
          const settings = await this.getSettings();
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
                  const planSegmentGroups = derivePlanSegments(sub.plan, authService);

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

          // Include legacy user.subscription plans for backward compatibility
          const legacyUsers = await User.find({
              status: 'Active',
              'subscription.plan': { $exists: true, $ne: 'free' },
              $or: [
                  { 'subscription.expiresAt': { $exists: false } },
                  { 'subscription.expiresAt': null },
                  { 'subscription.expiresAt': { $gt: now } }
              ]
          }).select('_id subscription').lean();

          legacyUsers.forEach((legacyUser) => {
              if (!legacyUser?._id) return;
              const legacyGroups = mapLegacyPlanToAudienceGroups(legacyUser.subscription?.plan);
              if (legacyGroups.length === 0) return;
              if (
                  signalAudienceGroups.length === 0 ||
                  hasAudienceOverlap(legacyGroups, signalAudienceGroups)
              ) {
                  candidateUserIds.add(legacyUser._id.toString());
              }
          });

          // Also include the Creator for verification (if not already included)
          const createdById = signal.createdBy ? signal.createdBy.toString() : null;
          if (createdById) candidateUserIds.add(createdById);

          let users = [];
          if (debugBroadcastAll) {
              logger.warn('[ALERT] DEBUG_SIGNAL_BROADCAST_ALL enabled - sending to all active users.');
              users = await User.find({ status: 'Active' })
                  .select('_id name email role fcmTokens phone phoneNumber preferredSegments marketWatchlist isNotificationEnabled isWhatsAppEnabled isEmailAlertEnabled telegramChatId telegramUsername')
                  .lean();
          } else {
              const candidateIds = Array.from(candidateUserIds);
              users = candidateIds.length > 0
                  ? await User.find({
                        _id: { $in: candidateIds },
                        status: 'Active'
                    }).select('_id name email role fcmTokens phone phoneNumber preferredSegments marketWatchlist isNotificationEnabled isWhatsAppEnabled isEmailAlertEnabled telegramChatId telegramUsername')
                  : [];
          }
          const allSelectedSymbols = users.flatMap((user) => getUserSelectedSymbols(user));
          const selectedSymbolDocs = allSelectedSymbols.length > 0
              ? await MasterSymbol.find({ symbol: { $in: allSelectedSymbols } }).select('symbol segment exchange').lean()
              : [];
          const selectedSymbolDocsMap = buildSelectedSymbolDocsMap(selectedSymbolDocs);

          const selectionStateByUser = new Map();
          users.forEach((user) => {
              const userId = user?._id?.toString() || '';
              const selectedSymbols = getUserSelectedSymbols(user, selectedSymbolDocsMap);
              const hasSymbol = hasSelectedSignalSymbol(selectedSymbols, signal.symbol);
              selectionStateByUser.set(userId, {
                  userId,
                  selectedCount: selectedSymbols.length,
                  hasSymbol,
                  isWhatsAppEnabled: user?.isWhatsAppEnabled !== false,
                  hasPhone: Boolean(user?.phoneNumber || user?.phone),
                  isNotificationsEnabled: user?.isNotificationEnabled !== false,
              });
          });

          const eligibleUsers = debugBroadcastAll
              ? users
              : users.filter((user) => {
              const userId = user?._id?.toString() || '';
              const isPrivilegedCreator =
                  createdById &&
                  userId === createdById &&
                  user.role !== 'user';

              if (!isPrivilegedCreator) {
                  const state = selectionStateByUser.get(userId);
                  if (!state?.hasSymbol) {
                      return false;
                  }
              }

              // Watchlist selection is explicit; don't block by preferred segments.
              return true;
          });

          logger.info(`Found ${eligibleUsers.length} eligible users for Signal ${signal.symbol}`);

          if (eligibleUsers.length === 0 && !debugBroadcastAll) {
              const selectionFailures = Array.from(selectionStateByUser.values())
                  .filter((entry) => !entry.hasSymbol)
                  .slice(0, 6)
                  .map((entry) => ({
                      userId: entry.userId,
                      selectedCount: entry.selectedCount,
                      hasPhone: entry.hasPhone,
                      isWhatsAppEnabled: entry.isWhatsAppEnabled,
                  }));

              logger.warn('[ALERT] No eligible users for signal', {
                  signal: { symbol: signal.symbol, segment: signal.segment, audience: signalAudienceGroups },
                  candidates: {
                      activeSubs: activeSubs.length,
                      activeSegmentSubs: activeSegmentSubs.length,
                      legacyUsers: legacyUsers.length,
                      candidateUserIds: candidateUserIds.size,
                      usersFetched: users.length,
                  },
                  selectionFailures,
              });
          }

          // Step B: Schedule Jobs for each user
          let whatsappScheduled = 0;
          let whatsappSkippedNoPhone = 0;
          let whatsappSkippedDisabled = 0;
          let whatsappSkippedGlobal = 0;
          const signalEventKey = buildSignalEventKey(signal);
          const jobRetentionSeconds = Number.isFinite(config.notifications?.jobRetentionSeconds)
            ? Math.max(config.notifications.jobRetentionSeconds, 60)
            : 3600;
          const jobAttempts = Number.isFinite(config.notifications?.jobAttempts)
            ? Math.max(config.notifications.jobAttempts, 1)
            : 3;
          const jobBackoffMs = Number.isFinite(config.notifications?.jobBackoffMs)
            ? Math.max(config.notifications.jobBackoffMs, 0)
            : 1000;
          const jobBatchSize = Number.isFinite(config.notifications?.jobBatchSize)
            ? Math.max(config.notifications.jobBatchSize, 50)
            : 200;

          const baseJobOptions = {
              attempts: jobAttempts,
              backoff: { type: 'exponential', delay: jobBackoffMs },
              removeOnComplete: { age: jobRetentionSeconds },
              removeOnFail: { age: jobRetentionSeconds },
          };

          const jobs = [];
          eligibleUsers.forEach((user) => {
              const userId = user._id.toString();

              if (
                  (teleConfig ? teleConfig.enabled !== false : Boolean(process.env.TELEGRAM_BOT_TOKEN)) &&
                  user.isNotificationEnabled !== false &&
                  user.telegramChatId
              ) {
                  jobs.push({
                      name: 'send-telegram',
                      data: { type: 'telegram', userId, signal },
                      opts: { ...baseJobOptions, jobId: buildJobId(signalEventKey, userId, 'telegram') }
                  });
              }

              if (pushConfig && pushConfig.enabled && user.isNotificationEnabled !== false) {
                  jobs.push({
                      name: 'send-push',
                      data: { type: 'push', userId, signal },
                      opts: { ...baseJobOptions, jobId: buildJobId(signalEventKey, userId, 'push') }
                  });
              }

              if (!whatsappEnabled) {
                  whatsappSkippedGlobal += 1;
              } else if (user.isWhatsAppEnabled === false) {
                  whatsappSkippedDisabled += 1;
              } else if (!(user.phoneNumber || user.phone)) {
                  whatsappSkippedNoPhone += 1;
              } else {
                  whatsappScheduled += 1;
                  jobs.push({
                      name: 'send-whatsapp',
                      data: { type: 'whatsapp', userId, signal },
                      opts: { ...baseJobOptions, jobId: buildJobId(signalEventKey, userId, 'whatsapp') }
                  });
              }

              if (user.email) {
                  jobs.push({
                      name: 'send-email-signal',
                      data: { type: 'email', userId, email: user.email, signal },
                      opts: { ...baseJobOptions, jobId: buildJobId(signalEventKey, userId, 'email') }
                  });
              }
          });

          if (jobs.length > 0) {
              const jobSummary = await addJobsInBatches(jobs, jobBatchSize);
              if (jobSummary.failed > 0) {
                  logger.warn('[ALERT] Notification queue job failures', jobSummary);
              } else if (jobSummary.skipped > 0) {
                  logger.debug('[ALERT] Duplicate notification jobs skipped', jobSummary);
              }
          }

          if (eligibleUsers.length > 0 && whatsappScheduled === 0) {
              logger.warn('[ALERT] No WhatsApp recipients for signal', {
                  signal: { symbol: signal.symbol, segment: signal.segment },
                  whatsappEnabled,
                  eligibleUsers: eligibleUsers.length,
                  skipped: {
                      globalDisabled: whatsappSkippedGlobal,
                      userDisabled: whatsappSkippedDisabled,
                      missingPhone: whatsappSkippedNoPhone,
                  },
              });
          }
          

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
              link: `/signals`,
              dedupKey: buildNotificationDedupKey(signalEventKey, user._id),
          }));

          if (notificationDocs.length > 0) {
              const ops = notificationDocs.map((doc) => ({
                  updateOne: {
                      filter: { dedupKey: doc.dedupKey },
                      update: { $setOnInsert: doc },
                      upsert: true
                  }
              }));
              const bulkResult = await Notification.bulkWrite(ops, { ordered: false });
              const upserted = bulkResult?.getUpsertedIds
                  ? bulkResult.getUpsertedIds()
                  : Object.values(bulkResult?.upsertedIds || {});
              const upsertedIds = upserted.map((entry) => entry?._id || entry);
              if (upsertedIds.length > 0) {
                  const createdNotifications = await Notification.find({ _id: { $in: upsertedIds } });
                  emitRealtimeNotifications(createdNotifications);
              }
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
          if (targetAudience && (targetAudience.planValues?.length > 0 || targetAudience.segments?.length > 0 || targetAudience.includeCustomPlans)) {
              const { default: Subscription } = await import('../models/Subscription.js');
              const { default: Plan } = await import('../models/Plan.js');

              const eligiblePlansFilters = [];
              const segmentFilters = [];

              if (targetAudience.segments?.length > 0) {
                  // Check direct segment OR specific permissions (most sub-categories are in permissions)
                  segmentFilters.push({ segment: { $in: targetAudience.segments } });
                  segmentFilters.push({ segments: { $in: targetAudience.segments } });
                  segmentFilters.push({ permissions: { $in: targetAudience.segments } });
              }

              if (targetAudience.planValues?.length > 0) {
                  eligiblePlansFilters.push({ name: { $in: targetAudience.planValues } });
              }

              if (targetAudience.includeCustomPlans) {
                  if (segmentFilters.length > 0) {
                      eligiblePlansFilters.push({ isCustom: true, $or: segmentFilters });
                  } else {
                      eligiblePlansFilters.push({ isCustom: true });
                  }
              } else if (segmentFilters.length > 0) {
                  eligiblePlansFilters.push(...segmentFilters);
              }

              const eligiblePlans = eligiblePlansFilters.length > 0
                  ? await Plan.find({ $or: eligiblePlansFilters }).select('_id isDemo')
                  : [];
              const eligiblePlanIds = eligiblePlans.map(p => p._id);

              if (eligiblePlanIds.length > 0) {
                  const now = new Date();
                  const activeSubs = await Subscription.find({
                      status: 'active',
                      endDate: { $gt: now },
                      plan: { $in: eligiblePlanIds }
                  }).select('user').lean();
                  
                  const userIdsFromSubs = Array.from(new Set(activeSubs.map(s => s.user.toString())));
                  let combinedUserIds = userIdsFromSubs;

                  // If any selected plan is demo, include demo segment subscribers too
                  const hasDemoPlan = eligiblePlans.some(p => p.isDemo);
                  if (hasDemoPlan) {
                      const { default: UserSubscription } = await import('../models/UserSubscription.js');
                      const demoSubs = await UserSubscription.find({
                          status: 'active',
                          is_active: true,
                          plan_type: 'demo',
                          end_date: { $gt: now }
                      }).select('user_id').lean();
                      const demoUserIds = Array.from(new Set(demoSubs.map(s => s.user_id.toString())));
                      combinedUserIds = Array.from(new Set([...combinedUserIds, ...demoUserIds]));
                  }

                  query._id = { $in: combinedUserIds };
              } else {
                  logger.info('No matching plans found for targeting filters');
                  return;
              }
          }

          if (debugLive) {
              logger.debug(`[DEBUG-LIVE] Target Audience: ${JSON.stringify(targetAudience)}`);
              logger.debug(`[DEBUG-LIVE] Generated Query: ${JSON.stringify(query)}`);
          }

          const users = await User.find(query).select('_id name email phone phoneNumber').lean();
          
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

                  // 3. Email Job
                  if (user.email) {
                      jobs.push(notificationQueue.add('send-email-announcement', {
                          type: 'email',
                          userId: user._id,
                          email: user.email,
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
          const userName = user?.name || 'Trader';
          const title = '⏳ Plan Expiring Soon';
          const whatsappNumber = '917770039037';
          const whatsappLink = `https://wa.me/${whatsappNumber}`;
          const message = [
              `Hi ${userName},`,
              '',
              `Your ${planName} plan expires in ${daysLeft} day(s) (${expiryDate}).`,
              'Please renew to continue receiving premium signals and alerts.',
              '',
              'MSPK Trade Solutions'
          ].join('\n');
          const whatsappMessage = [
              `Hi ${userName},`,
              '',
              `Your ${planName} plan expires in ${daysLeft} day(s) (${expiryDate}).`,
              'Please renew to continue receiving premium signals and alerts.',
              'Reply here to purchase the renewal and we will activate your plan immediately.',
              '',
              'MSPK Trade Solutions'
          ].join('\n');
          
          // 1. Send Push Notification
              await notificationQueue.add('send-push-reminder', {
                  type: 'push',
                  userId: user._id,
                  notification: {
                      title,
                      message,
                      type: 'SUBSCRIPTION_EXPIRY_REMINDER',
                      data: {
                          subscriptionId: subscription._id,
                          planName,
                          daysLeft,
                          expiryDate,
                          url: '/dashboard/notifications',
                          whatsappLink
                      },
                      link: '/dashboard/notifications'
                  }
              }, { removeOnComplete: true });

          // 2. Send WhatsApp Notification
          await notificationQueue.add('send-whatsapp', {
              type: 'whatsapp',
              userId: user._id,
              notification: {
                  title,
                  message: whatsappMessage,
                  text: whatsappMessage
              }
          }, { removeOnComplete: true });

          // 3. Send Telegram Notification
          await notificationQueue.add('send-telegram', {
              type: 'telegram',
              userId: user._id,
              notification: {
                  title,
                  message
              }
          }, { removeOnComplete: true });

          // 4. Send Email Notification
          await notificationQueue.add('send-email', {
              type: 'email',
              userId: user._id,
              email: user.email,
              subject: `⏳ Your ${planName} Plan Expires in ${daysLeft} Days`,
              template: 'pre-expiry-reminder',
              data: {
                  userName: user.name,
                  planName,
                  daysLeft,
                  expiryDate,
                  renewLink: `${config.frontendUrl}/renew-subscription`
              }
          }, { removeOnComplete: true });

          // 5. Create In-App Notification
          const notification = await Notification.create({
              user: user._id,
              title,
              message,
              type: 'SUBSCRIPTION_REMINDER',
              data: { subscriptionId: subscription._id, whatsappLink },
              link: '/dashboard/notifications'
          });
          emitRealtimeNotifications([notification]);

          logger.info(`Pre-expiry reminder sent to user ${user._id} for subscription ${subscription._id}`);

      } catch (error) {
          logger.error(`Failed to send pre-expiry reminder for user ${user._id}`, error);
      }
  }

  async sendDemoExpiryReminder(user, subscription, daysLeft) {
      try {
          const expiryDate = new Date(subscription.end_date || subscription.endDate).toLocaleDateString('en-IN');
          const userName = user?.name || 'Trader';
          const title = '⏳ Demo Access Ending Soon';
          const whatsappNumber = '917770039037';
          const whatsappLink = `https://wa.me/${whatsappNumber}`;
          const message = [
              `Hi ${userName},`,
              '',
              `Your demo access ends in ${daysLeft} day(s) (${expiryDate}).`,
              'Upgrade now to keep receiving premium trading signals and alerts.',
              '',
              'MSPK Trade Solutions'
          ].join('\n');
          const whatsappMessage = [
              `Hi ${userName},`,
              '',
              `Your demo access ends in ${daysLeft} day(s) (${expiryDate}).`,
              'Upgrade now to keep receiving premium trading signals and alerts.',
              'Reply here to purchase your plan and we will activate it immediately.',
              '',
              'MSPK Trade Solutions'
          ].join('\n');

          await notificationQueue.add('send-push-reminder', {
              type: 'push',
              userId: user._id,
              notification: {
                  title,
                  message,
                  type: 'DEMO_EXPIRY_REMINDER',
                  data: {
                      subscriptionId: subscription._id,
                      daysLeft,
                      expiryDate,
                      url: '/dashboard/notifications',
                      whatsappLink
                  },
                  link: '/dashboard/notifications'
              }
          }, { removeOnComplete: true });

          await notificationQueue.add('send-whatsapp', {
              type: 'whatsapp',
              userId: user._id,
              notification: {
                  title,
                  message: whatsappMessage,
                  text: whatsappMessage
              }
          }, { removeOnComplete: true });

          await notificationQueue.add('send-telegram', {
              type: 'telegram',
              userId: user._id,
              notification: {
                  title,
                  message
              }
          }, { removeOnComplete: true });

          const notification = await Notification.create({
              user: user._id,
              title,
              message,
              type: 'DEMO_REMINDER',
              data: { subscriptionId: subscription._id, whatsappLink },
              link: '/dashboard/notifications'
          });
          emitRealtimeNotifications([notification]);
      } catch (error) {
          logger.error(`Failed to send demo expiry reminder for user ${user?._id}`, error);
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

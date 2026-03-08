import { Worker } from 'bullmq';
import config from '../config/config.js';
import logger from '../config/log.js';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import FCMToken from '../models/FCMToken.js';
import { initializeFirebase } from '../config/firebase.js';
import telegramService from '../services/channels/telegram.service.js';
import whatsappChannelService from '../services/channels/whatsapp.service.js';
import { emailService } from '../services/index.js'; // Use central service exports
import pushService from '../services/channels/push.service.js';
import templates from '../config/notificationTemplates.js';
import {
  buildSignalTemplateData,
  getSignalTemplateKey,
  renderNotificationTemplate,
} from '../utils/notificationFormatter.js';

// Ensure Firebase is initialized in worker context
initializeFirebase();

const connection = {
  host: config.redis.host,
  port: config.redis.port,
};

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildEmailHtml = (subject = 'Notification', text = '') => {
  const safeSubject = escapeHtml(subject);
  const safeBody = escapeHtml(text).replace(/\n/g, '<br />');

  return `
    <div style="font-family:Arial,sans-serif;background:#0f172a;padding:24px;color:#e2e8f0;">
      <div style="max-width:640px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:16px;overflow:hidden;">
        <div style="padding:20px 24px;border-bottom:1px solid #1f2937;background:#0b1220;">
          <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#60a5fa;font-weight:700;">MSPK Trade Solutions</div>
          <h1 style="margin:12px 0 0;font-size:20px;line-height:1.4;color:#f8fafc;">${safeSubject}</h1>
        </div>
        <div style="padding:24px;font-size:14px;line-height:1.7;color:#cbd5e1;">${safeBody}</div>
      </div>
    </div>
  `;
};

const renderStandaloneEmailJob = ({ subject, template, data = {}, notification, user }) => {
  if (notification?.title || notification?.message) {
    const resolvedSubject = notification.title || subject || 'Notification';
    const resolvedText = notification.message || '';
    return {
      subject: resolvedSubject,
      text: resolvedText,
      html: buildEmailHtml(resolvedSubject, resolvedText),
    };
  }

  if (template === 'pre-expiry-reminder') {
    const resolvedSubject = subject || `Your ${data.planName || 'Subscription'} Plan Expires Soon`;
    const resolvedText = [
      `Hi ${data.userName || user?.name || 'Trader'},`,
      '',
      `Your ${data.planName || 'Subscription'} plan expires in ${data.daysLeft ?? '-'} day(s)${data.expiryDate ? ` on ${data.expiryDate}` : ''}.`,
      data.renewLink ? `Renew here: ${data.renewLink}` : '',
      '',
      'MSPK Trade Solutions',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      subject: resolvedSubject,
      text: resolvedText,
      html: buildEmailHtml(resolvedSubject, resolvedText),
    };
  }

  if (template === 'subscription-expired') {
    const resolvedSubject = subject || `Your ${data.planName || 'Subscription'} Plan Has Expired`;
    const resolvedText = [
      `Hi ${data.userName || user?.name || 'Trader'},`,
      '',
      `Your ${data.planName || 'Subscription'} plan has expired.`,
      data.renewLink ? `Renew here: ${data.renewLink}` : '',
      '',
      'MSPK Trade Solutions',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      subject: resolvedSubject,
      text: resolvedText,
      html: buildEmailHtml(resolvedSubject, resolvedText),
    };
  }

  const resolvedSubject = subject || 'Notification';
  const resolvedText = data.message || data.body || '';
  return {
    subject: resolvedSubject,
    text: resolvedText,
    html: buildEmailHtml(resolvedSubject, resolvedText),
  };
};

const notificationWorker = new Worker('notifications', async (job) => {
  const {
    type,
    signal,
    announcement,
    userId,
    email,
    subject,
    template,
    data,
    notification,
    recipient,
  } = job.data;
  
  try {
      // Fetch System Settings
      const settings = await Setting.find({
          key: { $in: ['telegram_config', 'whatsapp_config', 'push_config', 'email_config', 'notification_templates'] }
      });
      
      const getSetting = (key) => {
          const s = settings.find(s => s.key === key);
          return s ? s.value : null;
      };

      const dbTemplates = getSetting('notification_templates') || {};
      const activeTemplates = { ...templates, ...dbTemplates };

      const isTelegramJob = type === 'telegram';
      const isEmailJob = type === 'email';
      const isWhatsAppTestJob = type === 'whatsapp-test';
      const isSystemJob = userId === 'system';
      let user = null;
      if (!isSystemJob && userId) {
          user = await User.findById(userId);
      }
      
      if (!user && !isSystemJob && !(isEmailJob && email)) {
          logger.warn(`User ${userId} not found for notification`);
          return;
      }

      if (!isTelegramJob && isSystemJob) {
           logger.warn('Skipping notification job for "system" user (Broadcast should fan-out IDs)');
           return;
      }

      let title = 'Notification';
      let message = '';
      let html = '';
      
      if (signal) {
          const data = buildSignalTemplateData(signal);
          const templateKey = getSignalTemplateKey(signal);
          const rendered = renderNotificationTemplate(activeTemplates, templateKey, data);
          title = rendered.title;
          message = rendered.body;
          html = buildEmailHtml(title, message);
      } else if (announcement) {
          // Determine subtype
          let templateKey = 'ANNOUNCEMENT';
          if (announcement.type === 'ECONOMIC') templateKey = 'ECONOMIC_ALERT';
          if (announcement.type === 'REMINDER') templateKey = 'PLAN_EXPIRY_REMINDER';
          if (announcement.type === 'TICKET_REPLY') templateKey = 'TICKET_REPLY';
          
          const rendered = renderNotificationTemplate(activeTemplates, templateKey, announcement);
          title = rendered.title;
          message = rendered.body;
          html = buildEmailHtml(title, message);
      } else if (notification && !isEmailJob) {
          title = notification.title || notification?.notification?.title || 'Notification';
          message =
            notification.message ||
            notification.body ||
            notification?.notification?.body ||
            '';
          html = buildEmailHtml(title, message);
      } else if (isEmailJob) {
          const rendered = renderStandaloneEmailJob({ subject, template, data, notification, user });
          title = rendered.subject;
          message = rendered.text;
          html = rendered.html;
      } else {
          logger.warn('Unknown notification payload');
          return;
      }

      if (type === 'telegram') {
          const teleConfig = getSetting('telegram_config') || {};
          const telegramEnabled = teleConfig.enabled !== false;
          const targetChatId = isSystemJob ? teleConfig.channelId : user?.telegramChatId;

          if (telegramEnabled && targetChatId) {
             await telegramService.sendTelegramMessage(teleConfig, message, { chatId: targetChatId });
          } else {
             logger.debug(`Skipping Telegram for job ${job.id} - disabled or chat not connected`);
          }
      } 
       else if (type === 'whatsapp' || type === 'whatsapp-test') {
           const waConfig = getSetting('whatsapp_config');
           const whatsappRecipient = recipient || user?.phoneNumber || user?.phone;
           if (
             whatsappChannelService.isConfigured(waConfig) &&
             whatsappRecipient &&
             (isWhatsAppTestJob || (user && user.isWhatsAppEnabled !== false))
           ) {
               await whatsappChannelService.sendNotification(waConfig, {
                   to: whatsappRecipient,
                   text: notification?.text,
                   title,
                   message,
                   signal,
                   announcement,
               });
           } else {
               logger.debug(`Skipping WhatsApp for User ${userId} - channel disabled, recipient missing, or user opted out`);
           }
      }
      else if (type === 'push') {
          const pushConfig = getSetting('push_config');
          // Always allow push notifications (ignore disabled settings as requested).
          if (true) {
              const tokenDocs = await FCMToken.find({ user: userId }).select('token platform');
              const androidTokens = tokenDocs.filter(t => t.platform === 'android').map(t => t.token);
              const webTokens = tokenDocs.filter(t => t.platform === 'web').map(t => t.token);

              if (androidTokens.length === 0 && webTokens.length === 0) {
                  logger.warn(`[PushWorker] No FCM tokens for User ${userId}. Skipping push.`);
              }

              // Prepare data payload for deep-linking
              const pushData = { screen: "NOTIFICATIONS" };
              if (signal) pushData.signalId = signal._id;
              if (announcement) pushData.announcementId = announcement._id;
              if (notification && notification.data && typeof notification.data === 'object') {
                  Object.assign(pushData, notification.data);
              }
              if (notification?.link && !pushData.url) pushData.url = notification.link;
              if (!pushData.url) pushData.url = "/dashboard/notifications";
              if (!pushData.title) pushData.title = title;
              if (!pushData.body) pushData.body = message;

              if (androidTokens.length > 0) {
                  logger.info(`[PushWorker] Sending ANDROID to User ${userId}. Tokens: ${androidTokens.length}. Title: ${title}`);
                  const result = await pushService.sendPushNotification(
                      androidTokens, 
                      title, 
                      message,
                      pushData,
                      'android'
                  );
                  logger.info(`[PushWorker] ANDROID Result for User ${userId}: Success=${result.successCount}, Failure=${result.failureCount}`);
              }

              if (webTokens.length > 0) {
                  logger.info(`[PushWorker] Sending WEB to User ${userId}. Tokens: ${webTokens.length}. Title: ${title}`);
                  const result = await pushService.sendPushNotification(
                      webTokens, 
                      title, 
                      message,
                      pushData,
                      'web'
                  );
                  logger.info(`[PushWorker] WEB Result for User ${userId}: Success=${result.successCount}, Failure=${result.failureCount}`);
              }
          } else {
              logger.warn('[PushWorker] push_config is disabled. Skipping push send.');
          }
      }
      else if (type === 'email') {
          const emailConfig = getSetting('email_config') || {};
          const emailEnabled = emailConfig.enabled !== false;
          const recipientEmail = email || user?.email;

          if (emailEnabled && recipientEmail) {
              await emailService.sendEmail(recipientEmail, title, message, html || buildEmailHtml(title, message));
          } else {
              logger.debug(`Skipping Email for job ${job.id} - disabled or recipient missing`);
          }
      }
      
      logger.info(`Processed ${type} notification for job ${job.id}`);
  } catch (error) {
      logger.error(`Failed to process notification job ${job.id}`, error);
  }
}, { connection });

notificationWorker.on('completed', (job) => {
  logger.debug(`Job ${job.id} completed`);
});

notificationWorker.on('failed', (job, err) => {
  logger.error(`Job ${job.id} failed: ${err.message}`);
});

export default notificationWorker;

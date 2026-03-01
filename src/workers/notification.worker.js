import { Worker } from 'bullmq';
import config from '../config/config.js';
import logger from '../config/log.js';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import telegramService from '../services/channels/telegram.service.js';
import { msg91Service } from '../services/index.js'; // Use Central MSG91 Service
import pushService from '../services/channels/push.service.js';
import templates from '../config/notificationTemplates.js';

const connection = {
  host: config.redis.host,
  port: config.redis.port,
};

const notificationWorker = new Worker('notifications', async (job) => {
  const { type, signal, announcement, userId } = job.data;
  
  try {
      // Fetch System Settings
      const settings = await Setting.find({ 
          key: { $in: ['telegram_config', 'whatsapp_config', 'push_config', 'notification_templates'] } 
      });
      
      const getSetting = (key) => {
          const s = settings.find(s => s.key === key);
          return s ? s.value : null;
      };

      const dbTemplates = getSetting('notification_templates') || {};
      const activeTemplates = { ...templates, ...dbTemplates };

      let user = null;
      if (userId && userId !== 'system') {
          user = await User.findById(userId);
      }
      
      if (!user && userId !== 'system') {
          logger.warn(`User ${userId} not found for notification`);
          return;
      }

      if (userId === 'system') {
           logger.warn('Skipping notification job for "system" user (Broadcast should fan-out IDs)');
           return;
      }

      const renderTemplate = (templateKey, data) => {
          const template = activeTemplates[templateKey] || activeTemplates.ANNOUNCEMENT;
          let title = template.title;
          let body = template.body;

          // Simple variable replacement
          Object.keys(data).forEach(key => {
              const regex = new RegExp(`{{${key}}}`, 'g');
              const val = data[key] !== undefined ? data[key] : '';
              title = title.replace(regex, val);
              body = body.replace(regex, val);
          });
          return { title, body };
      };

      let title = 'Notification';
      let message = '';
      
      if (signal) {
          // Flatten signal data for template
          const data = {
              symbol: signal.symbol,
              type: signal.type,
              entryPrice: signal.entryPrice,
              stopLoss: signal.stopLoss,
              target1: signal.targets?.target1 || '-',
              target2: signal.targets?.target2 || '-',
              target3: signal.targets?.target3 || '-',
              notes: signal.notes || '',
              
              // For Update/Target
              updateMessage: signal.updateMessage || '',
              targetLevel: signal.targetLevel || 'TP1',
              currentPrice: signal.currentPrice || signal.entryPrice // fallback
          };
          
          // Use subType passed from publisher (SIGNAL_NEW, SIGNAL_UPDATE, SIGNAL_TARGET, SIGNAL_STOPLOSS)
          const templateKey = signal.subType || 'SIGNAL_NEW';
          
          const rendered = renderTemplate(templateKey, data);
          title = rendered.title;
          message = rendered.body;
      } else if (announcement) {
          // Determine subtype
          let templateKey = 'ANNOUNCEMENT';
          if (announcement.type === 'ECONOMIC') templateKey = 'ECONOMIC_ALERT';
          if (announcement.type === 'REMINDER') templateKey = 'PLAN_EXPIRY_REMINDER';
          if (announcement.type === 'TICKET_REPLY') templateKey = 'TICKET_REPLY';
          
          const rendered = renderTemplate(templateKey, announcement);
          title = rendered.title;
          message = rendered.body;
      } else {
          logger.warn('Unknown notification payload');
          return;
      }

      if (type === 'telegram') {
          const teleConfig = getSetting('telegram_config');
          if (teleConfig && teleConfig.enabled && teleConfig.botToken && teleConfig.channelId) {
             await telegramService.sendTelegramMessage(teleConfig, message);
          }
      } 
       else if (type === 'whatsapp') {
           const waConfig = getSetting('whatsapp_config');
           // Strict Check: WhatsApp must be enabled in Admin Settings
           if (waConfig && waConfig.enabled) {
               // MSG91 WhatsApp requires Template + Components
               if (user.phoneNumber || user.phone) {
                   const phone = user.phoneNumber || user.phone;
                   let templateName = 'signal_alert';
                   let components = {};
    
                   if (signal) {
                       components = {
                           "1": signal.symbol,
                           "2": signal.type,
                           "3": signal.entryPrice,
                           "4": signal.stopLoss,
                           "5": signal.targets?.target1 || '-'
                       };
                   } else if (announcement) {
                       templateName = 'announcement_alert';
                       components = {
                           "1": announcement.title,
                           "2": announcement.message
                       };
                   }
    
                   await msg91Service.sendWhatsapp(phone, templateName, components);
               }
           } else {
               logger.debug(`Skipping WhatsApp for User ${userId} - Channel Disabled in Settings`);
           }
      }
      else if (type === 'push') {
          const pushConfig = getSetting('push_config');
          // If pushConfig exists and is enabled, we send. 
          if (pushConfig && pushConfig.enabled) {
              if (user.fcmTokens && user.fcmTokens.length > 0) {
                  // Prepare data payload for deep-linking
                  const pushData = { screen: "NOTIFICATIONS" };
                  if (signal) pushData.signalId = signal._id;
                  if (announcement) pushData.announcementId = announcement._id;

                  logger.info(`[PushWorker] Sending to User ${userId}. Tokens: ${user.fcmTokens.length}. Title: ${title}`);
                  
                  const result = await pushService.sendPushNotification(
                      user.fcmTokens, 
                      title, 
                      message,
                      pushData
                  );
                  logger.info(`[PushWorker] Send Result for User ${userId}: Success=${result.successCount}, Failure=${result.failureCount}`);
                  
                  if (result.failureCount > 0 && result.results) {
                       // Log specific error codes
                       const errors = result.results.filter(r => r.error).map(r => r.error);
                       if (errors.length > 0) {
                           logger.error(`[FCM_FAIL_DETAILS] User ${userId} Errors: ${JSON.stringify(errors.map(e => ({ code: e.code, message: e.message })))}`);
                       }
                  }
              }
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

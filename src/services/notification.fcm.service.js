import { admin } from '../config/firebase.js';
import User from '../models/User.js';
import logger from '../config/log.js';

/**
 * Send push notification to specific users
 * @param {Array} userIds - List of user IDs
 * @param {Object} payload - Notification payload { title, body, data }
 */
const sendToUsers = async (userIds, payload) => {
  try {
    const users = await User.find({ _id: { $in: userIds } }).select('fcmTokens');
    const allTokens = users.flatMap(user => user.fcmTokens || []);

    if (allTokens.length === 0) return;

    await sendToTokens(allTokens, payload);
  } catch (error) {
    logger.error('Error in sendToUsers FCM:', error);
  }
};

/**
 * Send push notification to specific tokens
 * @param {Array} tokens - List of FCM tokens
 * @param {Object} payload - Notification payload
 */
const sendToTokens = async (tokens, payload) => {
  if (!tokens || tokens.length === 0) return;

  const uniqueTokens = [...new Set(tokens)];
  const message = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data || {},
    tokens: uniqueTokens,
  };

  try {
    const response = await admin.messaging().sendMulticast(message);
    logger.info(`Successfully sent ${response.successCount} messages; ${response.failureCount} messages failed.`);
    
    if (response.failureCount > 0) {
      // Logic to cleanup invalid tokens could go here
    }
  } catch (error) {
    logger.error('Error sending multicast FCM:', error);
  }
};

/**
 * Send push notification to a topic
 * @param {String} topic - FCM topic name
 * @param {Object} payload - Notification payload
 */
const sendToTopic = async (topic, payload) => {
  const message = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data || {},
    topic: topic,
  };

  try {
    const response = await admin.messaging().send(message);
    logger.info('Successfully sent message to topic:', response);
  } catch (error) {
    logger.error('Error sending topic FCM:', error);
  }
};

export default {
  sendToUsers,
  sendToTokens,
  sendToTopic,
};

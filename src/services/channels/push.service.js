import { admin } from '../../config/firebase.js';
import logger from '../../config/logger.js';

const sendPushNotification = async (tokens, title, body, data = {}) => {
    try {
        if (!tokens || tokens.length === 0) {
            logger.warn('No FCM tokens provided for push notification');
            return false;
        }

        const uniqueTokens = [...new Set(tokens)];
        
        // Ensure all data values are strings (FCM requirement)
        const stringData = {};
        Object.keys(data).forEach(key => {
            stringData[key] = String(data[key]);
        });

        const message = {
            notification: {
                title: title,
                body: body,
            },
            android: {
                notification: {
                    channelId: 'high_importance_channel',
                    priority: 'high',
                    defaultSound: true,
                },
            },
            data: stringData,
            tokens: uniqueTokens,
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        logger.info(`Push notification sent. Success: ${response.successCount}, Failure: ${response.failureCount}`);
        
        return response; // Return full response object
    } catch (error) {
        logger.error('Push Notification Error:', error.message);
        return { successCount: 0, failureCount: 0, results: [], error: error.message };
    }
};

export default {
    sendPushNotification
};

import { admin } from '../../config/firebase.js';
import logger from '../../config/log.js';
import FCMToken from '../../models/FCMToken.js';

const INVALID_TOKEN_ERRORS = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
]);

const buildMessage = (tokens, title, body, data, platform) => {
    const message = {
        notification: {
            title: title,
            body: body,
        },
        data: data,
        tokens: tokens,
    };

    if (platform === 'android') {
        message.android = {
            priority: 'high',
            notification: {
                channelId: 'mspk-alerts',
                sound: 'default',
            },
        };
    }

    return message;
};

const sendPushNotification = async (tokens, title, body, data = {}, platform = 'android') => {
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

        const message = buildMessage(uniqueTokens, title, body, stringData, platform);

        const response = await admin.messaging().sendEachForMulticast(message);
        logger.info(`Push notification sent. Success: ${response.successCount}, Failure: ${response.failureCount}`);

        if (response.failureCount > 0 && response.results) {
            const invalidTokens = [];
            response.results.forEach((result, index) => {
                if (result.error && INVALID_TOKEN_ERRORS.has(result.error.code)) {
                    invalidTokens.push(uniqueTokens[index]);
                }
            });

            if (invalidTokens.length > 0) {
                await FCMToken.deleteMany({ token: { $in: invalidTokens } });
                logger.warn(`Removed ${invalidTokens.length} invalid FCM tokens from DB`);
            }
        }
        
        return response; // Return full response object
    } catch (error) {
        logger.error('Push Notification Error:', error.message);
        return { successCount: 0, failureCount: 0, results: [], error: error.message };
    }
};

export default {
    sendPushNotification
};

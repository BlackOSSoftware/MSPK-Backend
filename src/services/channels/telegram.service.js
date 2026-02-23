import axios from 'axios';
import logger from '../../config/logger.js';

const sendTelegramMessage = async (config, message) => {
    try {
        const { botToken, channelId } = config;
        if (!botToken || !channelId) {
            throw new Error('Missing Telegram Bot Token or Channel ID');
        }

        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        
        await axios.post(url, {
            chat_id: channelId,
            text: message,
            parse_mode: 'HTML' // Support bold/italic
        });

        logger.info(`Telegram message sent to ${channelId}`);
        return true;
    } catch (error) {
        logger.error('Telegram Send Error', error.response?.data || error.message);
        throw error;
    }
};

export default {
    sendTelegramMessage
};

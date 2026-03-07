import axios from 'axios';
import logger from '../../config/log.js';
import config from '../../config/config.js';

const getTelegramConfig = (settingsConfig = {}) => {
    const resolved = settingsConfig && typeof settingsConfig === 'object' ? settingsConfig : {};

    return {
        enabled: resolved.enabled !== false,
        botToken: resolved.botToken || config.telegram.botToken || '',
        botUsername: resolved.botUsername || config.telegram.botUsername || '',
        channelId: resolved.channelId || config.telegram.channelId || '',
        webhookBaseUrl: resolved.webhookBaseUrl || config.telegram.webhookBaseUrl || '',
        webhookSecret: resolved.webhookSecret || config.telegram.webhookSecret || '',
    };
};

const buildTelegramConnectUrl = (linkToken, settingsConfig = {}) => {
    const { botUsername } = getTelegramConfig(settingsConfig);
    const normalizedToken = String(linkToken || '').trim();

    if (!botUsername || !normalizedToken) {
        return null;
    }

    return `https://t.me/${botUsername}?start=tg_${normalizedToken}`;
};

const buildWebhookUrl = (settingsConfig = {}) => {
    const { webhookBaseUrl, webhookSecret } = getTelegramConfig(settingsConfig);
    const normalizedBaseUrl = String(webhookBaseUrl || '').trim().replace(/\/+$/, '');
    const normalizedSecret = String(webhookSecret || '').trim();

    if (!normalizedBaseUrl || !normalizedSecret) {
        return null;
    }

    return `${normalizedBaseUrl}/v1/notifications/telegram/webhook/${normalizedSecret}`;
};

const ensureTelegramWebhook = async (settingsConfig = {}) => {
    const resolved = getTelegramConfig(settingsConfig);
    const webhookUrl = buildWebhookUrl(resolved);

    if (!resolved.botToken || !webhookUrl) {
        logger.warn('Telegram webhook skipped: missing bot token or webhook URL');
        return false;
    }

    try {
        const url = `https://api.telegram.org/bot${resolved.botToken}/setWebhook`;
        const response = await axios.post(url, {
            url: webhookUrl,
            allowed_updates: ['message'],
            drop_pending_updates: false,
        });

        logger.info(`Telegram webhook configured: ${webhookUrl}`);
        return Boolean(response.data?.ok);
    } catch (error) {
        logger.error('Telegram Webhook Setup Error', error.response?.data || error.message);
        return false;
    }
};

const sendTelegramMessage = async (settingsConfig, message, options = {}) => {
    try {
        const resolved = getTelegramConfig(settingsConfig);
        const chatId = options.chatId || resolved.channelId;

        if (!resolved.botToken || !chatId) {
            throw new Error('Missing Telegram Bot Token or Chat ID');
        }

        const url = `https://api.telegram.org/bot${resolved.botToken}/sendMessage`;
        
        await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: options.parseMode || 'HTML'
        });

        logger.info(`Telegram message sent to ${chatId}`);
        return true;
    } catch (error) {
        logger.error('Telegram Send Error', error.response?.data || error.message);
        throw error;
    }
};

export default {
    buildTelegramConnectUrl,
    buildWebhookUrl,
    ensureTelegramWebhook,
    getTelegramConfig,
    sendTelegramMessage
};

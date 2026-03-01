import axios from 'axios';
import logger from '../../config/log.js';

const sendWhatsAppMessage = async (config, { templateName, languageCode = 'en_US', parameters = [] }) => {
    try {
        const { apiKey, phoneNumberId } = config; // apiKey = Permanent/Temporary Access Token
        if (!apiKey || !phoneNumberId) {
            throw new Error('Missing WhatsApp API Key or Phone Number ID');
        }

        const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;

        // Currently supporting Template Messages (Standard for Business API)
        const payload = {
            messaging_product: 'whatsapp',
            to: config.to, // Recipient Phone Number
            type: 'template',
            template: {
                name: templateName,
                language: {
                    code: languageCode
                },
                components: [
                    {
                        type: 'body',
                        parameters: parameters // Array of { type: 'text', text: 'value' }
                    }
                ]
            }
        };

        await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        logger.info(`WhatsApp message sent to ${config.to}`);
        return true;
    } catch (error) {
        logger.error('WhatsApp Send Error', error.response?.data || error.message);
        // Don't throw logic error to stop other channels, but for worker retry it might be needed. 
        // For now logging it.
        throw error;
    }
};

const sendWhatsAppText = async (config, text) => {
     try {
        const { apiKey, phoneNumberId } = config;
        if (!apiKey || !phoneNumberId) {
            throw new Error('Missing WhatsApp API Key or Phone Number ID');
        }

        const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;

        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: "individual",
            to: config.to,
            type: "text",
            text: {
                preview_url: false,
                body: text
            }
        };

        await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        logger.info(`WhatsApp text sent to ${config.to}`);
        return true;
    } catch (error) {
        logger.error('WhatsApp Text Send Error', error.response?.data || error.message);
        throw error;
    }
}

export default {
    sendWhatsAppMessage,
    sendWhatsAppText
};

import axios from 'axios';
import logger from '../config/log.js';

const normalizePhoneNumber = (value = '') => {
    let digits = String(value || '').replace(/\D/g, '');

    if (digits.length === 10) {
        digits = `91${digits}`;
    }

    return digits;
};

class WhatsappService {
    constructor() {
        this.token = process.env.WHATSAPP_ACCESS_TOKEN;
        this.phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        this.baseUrl = 'https://graph.facebook.com/v17.0';

        if (!this.token || !this.phoneId) {
             // logger.warn('WHATSAPP: Credentials missing in .env');
        }
    }

    initialize(token, phoneId) {
        this.token = token;
        this.phoneId = phoneId;

        if (!this.token || !this.phoneId) {
            logger.warn('WHATSAPP: Missing Credentials. Service disabled.');
        } else {
            logger.info('WHATSAPP: Service Initialized');
        }
    }

    /**
     * Send a Text Message
     * @param {string} to - Recipient Phone Number (e.g., '919876543210')
     * @param {string} message - Text body
     */
    async sendTextMessage(to, message) {
        if (!this.token || !this.phoneId) {
            logger.error('WHATSAPP: Meta credentials are missing in .env');
            return false;
        }

        const cleanPhone = normalizePhoneNumber(to);
        if (!cleanPhone) {
            logger.error('WHATSAPP: Recipient phone number is required');
            return false;
        }

        try {
            const url = `${this.baseUrl}/${this.phoneId}/messages`;
            const payload = {
                messaging_product: 'whatsapp',
                to: cleanPhone,
                type: 'text',
                text: { body: message }
            };

            const res = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });
            logger.info(`WHATSAPP: Text message sent to ${cleanPhone} (${res.data.messages?.[0]?.id || 'queued'})`);
            return true;
        } catch (error) {
            logger.error('WHATSAPP: Send Error');
            if (error.response) {
                logger.error(JSON.stringify(error.response.data));
            } else {
                logger.error(error.message);
            }
            return false;
        }
    }

    /**
     * Send a Template Message (For Notifications/OTP)
     * @param {string} to - Recipient Phone
     * @param {string} templateName - Name of template in Meta Manager
     * @param {Array} variables - List of variables for body (e.g. ['Aqib', 'Welcome'])
     * @param {string} language - Language code (default 'en_US')
     */
    async sendTemplate(to, templateName, variables = [], language = 'en_US') {
        if (!this.token || !this.phoneId) {
            logger.error('WHATSAPP: Meta credentials are missing in .env');
            return false;
        }

        const cleanPhone = normalizePhoneNumber(to);
        if (!cleanPhone) {
            logger.error('WHATSAPP: Recipient phone number is required for template send');
            return false;
        }

        if (!templateName) {
            logger.error('WHATSAPP: Template name is required');
            return false;
        }

        try {
            const components = [];
            if (variables.length > 0) {
                 components.push({
                    type: 'body',
                    parameters: variables.map((value) => ({ type: 'text', text: String(value ?? '') }))
                 });
            }

            const url = `${this.baseUrl}/${this.phoneId}/messages`;
            const payload = {
                messaging_product: 'whatsapp',
                to: cleanPhone,
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: language },
                    components
                }
            };

            await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });
            logger.info(`WHATSAPP: Sent template ${templateName} to ${cleanPhone}`);
            return true;
        } catch (error) {
            logger.error('WHATSAPP: Template Error', error.response?.data || error.message);
            return false;
        }
    }

    /**
     * Welcome New User (Auto-Reply Logic Placeholder)
     */
    async sendWelcomeMessage(to, userName) {
        const msg = `Welcome ${userName} to MSPK Trading!\nWe are glad to have you.`;
        await this.sendTextMessage(to, msg);
    }
}

export const whatsappService = new WhatsappService();

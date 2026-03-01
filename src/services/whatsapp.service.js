import axios from 'axios';
import logger from '../config/log.js';

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
        if (!this.token) {
            console.error('WHATSAPP: No Token Found! Check .env');
            return;
        }

        // Sanitize Phone: Remove all non-numeric characters (e.g. +, spaces, -)
        let cleanPhone = to.replace(/\D/g, '');
        
        // Auto-add text country code for India if missing (Common issue)
        if (cleanPhone.length === 10) {
            cleanPhone = '91' + cleanPhone;
        }
        
        console.log(`WHATSAPP: Sending to ${cleanPhone} (Original: ${to})`);

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
            console.log(`WHATSAPP: Success! Message ID: ${res.data.messages?.[0]?.id}`);
        } catch (error) {
            console.error('WHATSAPP: Send Error');
            if (error.response) {
                console.error('Data:', JSON.stringify(error.response.data, null, 2));
            } else {
                console.error('Message:', error.message);
            }
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
        if (!this.token) return;

        try {
            const components = [];
            if (variables.length > 0) {
                 components.push({
                    type: 'body',
                    parameters: variables.map(v => ({ type: 'text', text: v }))
                 });
            }

            const url = `${this.baseUrl}/${this.phoneId}/messages`;
            const payload = {
                messaging_product: 'whatsapp',
                to: to,
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: language },
                    components: components
                }
            };

            await axios.post(url, payload, {
                headers: { 
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });
            logger.info(`WHATSAPP: Sent template ${templateName} to ${to}`);
        } catch (error) {
            logger.error('WHATSAPP: Template Error', error.response?.data || error.message);
        }
    }

    /**
     * Welcome New User (Auto-Reply Logic Placeholder)
     */
    async sendWelcomeMessage(to, userName) {
        // You can switch this to a 'hello_world' template later if needed
        const msg = `Welcome ${userName} to MSPK Trading! 🚀\nWe are glad to have you.`;
        await this.sendTextMessage(to, msg);
    }
}

export const whatsappService = new WhatsappService();

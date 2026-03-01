import axios from 'axios';
import logger from '../config/log.js';

class Msg91Service {
    constructor() {
        this.authKey = process.env.MSG91_AUTH_KEY;
        this.baseUrl = 'https://control.msg91.com/api/v5';
    }

    /**
     * Send OTP via MSG91
     * @param {string} mobile - Mobile number with country code (e.g. 919876543210)
     * @param {string} templateId - MSG91 Template ID for OTP
     * @returns {Promise<boolean>}
     */
    async sendOtp(mobile, templateId) {
        if (!this.authKey) {
            logger.error('MSG91_AUTH_KEY is missing in .env');
            throw new Error('Server configuration error: MSG91 key missing');
        }

        try {
            const url = `${this.baseUrl}/otp`;
            const params = {
                mobile: mobile,
                template_id: templateId,
                authkey: this.authKey
            };

            const response = await axios.get(url, { params });

            if (response.data.type === 'success') {
                logger.info(`MSG91: OTP sent to ${mobile}`);
                return true;
            } else {
                logger.error(`MSG91: OTP Send Failed - ${JSON.stringify(response.data)}`);
                return false;
            }
        } catch (error) {
            logger.error(`MSG91: OTP Error - ${error.message}`);
            throw new Error('Failed to send OTP');
        }
    }

    /**
     * Verify OTP via MSG91
     * @param {string} mobile - Mobile number
     * @param {string} otp - The OTP entered by user
     * @returns {Promise<boolean>}
     */
    async verifyOtp(mobile, otp) {
        if (!this.authKey) throw new Error('MSG91_AUTH_KEY missing');

        try {
            const url = `${this.baseUrl}/otp/verify`;
            const params = {
                mobile: mobile,
                otp: otp,
                authkey: this.authKey
            };

            const response = await axios.get(url, { params });

            if (response.data.type === 'success') {
                logger.info(`MSG91: OTP Verified for ${mobile}`);
                return true;
            } else {
                logger.warn(`MSG91: OTP Verification Failed for ${mobile} - ${response.data.message}`);
                return false;
            }
        } catch (error) {
            logger.error(`MSG91: Verify Error - ${error.message}`);
            return false;
        }
    }

    /**
     * Send WhatsApp Message
     * @param {string} mobile - Mobile Number
     * @param {string} templateName - The defined template name in MSG91
     * @param {object} components - Variables for the template (e.g. { "1": "Aqib", "2": "Welcome" })
     * @returns {Promise<void>}
     */
    async sendWhatsapp(mobile, templateName, components = {}) {
        if (!process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER) {
             logger.warn('MSG91: WhatsApp Integrated Number not set in .env');
             return;
        }

        try {
           // This is a simplified implementation for MSG91's WhatsApp API
           // Docs: https://docs.msg91.com/reference/send-whatsapp-message
           const url = `https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/custom/${process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER}`;
           
           const payload = {
               integrated_number: process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER,
               content_type: "template",
               payload: {
                   to: mobile,
                   type: "template",
                   template: {
                       name: templateName,
                       language: {
                           code: "en", 
                           policy: "deterministic"
                       },
                       components: [
                           {
                               type: "body",
                               parameters: Object.keys(components).map(key => ({
                                   type: "text",
                                   text: components[key]
                               }))
                           }
                       ]
                   }
               }
           };

           const headers = {
               "authkey": this.authKey,
               "content-type": "application/json"
           };

           const response = await axios.post(url, payload, { headers });
           logger.info(`MSG91: WhatsApp sent to ${mobile} response: ${JSON.stringify(response.data)}`);

        } catch (error) {
            logger.error(`MSG91: WhatsApp Error - ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Send SMS
     * @param {string} mobile 
     * @param {string} message 
     * @param {string} senderId 
     */
    async sendSms(mobile, message, senderId) {
         if (!this.authKey) return;
         
         const flowId = process.env.MSG91_SMS_FLOW_ID; // Recommended to use Flow ID instead of raw text
         if (!flowId) {
             logger.warn("MSG91: flowId not provided for SMS");
             return;
         }

         try {
             const url = "https://control.msg91.com/api/v5/flow/";
             const payload = {
                 template_id: flowId,
                 short_url: "0",
                 recipients: [
                     {
                         mobiles: mobile,
                         VAR1: message // Assuming template has ##VAR1##
                     }
                 ]
             };
             
             const headers = {
                "authkey": this.authKey,
                "content-type": "application/json"
            };

            await axios.post(url, payload, { headers });
            logger.info(`MSG91: SMS sent to ${mobile}`);

         } catch (error) {
             logger.error(`MSG91: SMS Error - ${error.message}`);
         }
    }

    /**
     * Send Email via MSG91
     * @param {string} to - Recipient Email
     * @param {string} subject - Email Subject
     * @param {string} body - Email Body (HTML or Text) - Mapped to VAR1 if generic template used
     * @returns {Promise<boolean>}
     */
    async sendEmail(to, subject, body) {
        if (!this.authKey) return false;
        
        try {
            const url = "https://control.msg91.com/api/v5/email/send";
            const payload = {
                to: [{ email: to }],
                from: { 
                    email: process.env.MSG91_FROM_EMAIL || "no-reply@mspktrading.com", 
                    name: "MSPK TRADE SOLUTIONS" 
                },
                domain: process.env.MSG91_EMAIL_DOMAIN, 
                mail_type_id: "1", 
                // For generic email, we try to send subject/body directly. 
                // MSG91 v5 allows generic emails associated with verified domain without mandatory template_id if configured, 
                // OR we can use a generic template.
                // If the user set MSG91_EMAIL_TEMPLATE_ID to an OTP template, WE MUST NOT USE IT HERE.
                // Thus, we strip template_id from here unless strictly passed for generic use-cases.
                // Assuming simple subject/body sending is allowed for verified domains.
                subject: subject,
                body: body
            };

            const headers = {
                "authkey": this.authKey,
                "content-type": "application/json"
            };

            const response = await axios.post(url, payload, { headers });
            logger.info(`MSG91: Email sent to ${to}`);
            return true;

        } catch (error) {
            logger.error(`MSG91: Email Error - ${error.response?.data?.message || error.message}`);
            // Log full error for debugging
            if(error.response?.data) console.error(JSON.stringify(error.response.data));
            return false;
        }
    }

    /**
     * Send OTP via Email (MSG91 Template)
     * @param {string} to - Recipient Email
     * @param {string} otp - OTP Code
     * @returns {Promise<boolean>}
     */
    async sendEmailOtp(to, otp) {
        if (!this.authKey) return false;
        
        const templateId = process.env.MSG91_EMAIL_TEMPLATE_ID;
        if (!templateId) {
             logger.error("MSG91_EMAIL_TEMPLATE_ID not set for Email OTP");
             return false;
        }

        try {
            const url = "https://control.msg91.com/api/v5/email/send";
            const payload = {
                to: [{ email: to }],
                from: { 
                    email: process.env.MSG91_FROM_EMAIL, 
                    name: "MSPK Support" 
                },
                domain: process.env.MSG91_EMAIL_DOMAIN,
                template_id: templateId,
                variables: {
                    otp: otp,
                    company_name: "MSPK TRADE SOLUTIONS"
                }
                // NO Subject, NO Body - Template handles it
            };
            
            const headers = {
                "authkey": this.authKey,
                "content-type": "application/json"
            };

            const response = await axios.post(url, payload, { headers });
            logger.info(`MSG91: Email OTP sent to ${to}`);
            return true;

        } catch (error) {
            logger.error(`MSG91: Email OTP Error - ${error.response?.data?.message || error.message}`);
             if(error.response?.data) console.error(JSON.stringify(error.response.data));
            return false;
        }
    }
}

export default new Msg91Service();

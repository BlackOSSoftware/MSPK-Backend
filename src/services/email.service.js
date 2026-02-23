import { msg91Service } from './index.js';
import logger from '../config/logger.js';

/**
 * Send Email using MSG91
 * @param {string} to - Recipient Email
 * @param {string} subject - Email Subject
 * @param {string} text - Email Body
 * @param {string} html - Optional HTML body (Currently mapped to same VAR)
 * @returns {Promise<boolean>}
 */
const sendEmail = async (to, subject, text, html = null) => {
  const body = html || text;
  return await msg91Service.sendEmail(to, subject, body);
};

/**
 * Send OTP via Email (MSG91 Template)
 * @param {string} to 
 * @param {string} otp 
 * @returns {Promise<boolean>}
 */
const sendEmailOtp = async (to, otp) => {
    return await msg91Service.sendEmailOtp(to, otp);
};


const sendPushNotification = async (tokens, title, body) => {
    // Keeping this placeholder wrapper for consistency
    logger.info(`[PUSH] To: ${tokens?.length} devices, Title: ${title}, Body: ${body}`);
    return true;
};

export {
  sendEmail,
  sendEmailOtp,
  sendPushNotification,
};

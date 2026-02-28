import nodemailer from 'nodemailer';
import { msg91Service } from './index.js';
import logger from '../config/logger.js';

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpUser || !smtpPass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  return transporter;
};

/**
 * Send Email using MSG91
 * @param {string} to - Recipient Email
 * @param {string} subject - Email Subject
 * @param {string} text - Email Body
 * @param {string} html - Optional HTML body (Currently mapped to same VAR)
 * @returns {Promise<boolean>}
 */
const sendEmail = async (to, subject, text, html = null) => {
  const smtp = getTransporter();

  if (smtp) {
    try {
      await smtp.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        text,
        html: html || undefined,
      });
      return true;
    } catch (err) {
      logger.error(`SMTP Email Error - ${err.message}`);
    }
  }

  const body = html || text;
  return msg91Service.sendEmail(to, subject, body);
};

/**
 * Send OTP via Email (MSG91 Template)
 * @param {string} to 
 * @param {string} otp 
 * @returns {Promise<boolean>}
 */
const sendEmailOtp = async (to, otp) => {
    const smtp = getTransporter();

    if (smtp) {
      try {
        await smtp.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to,
          subject: 'Your OTP Code',
          text: `Your OTP is ${otp}. It is valid for 10 minutes.`,
          html: `<p>Your OTP is <b>${otp}</b>. It is valid for 10 minutes.</p>`,
        });
        return true;
      } catch (err) {
        logger.error(`SMTP OTP Email Error - ${err.message}`);
      }
    }

    return msg91Service.sendEmailOtp(to, otp);
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

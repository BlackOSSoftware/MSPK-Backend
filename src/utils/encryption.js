import crypto from 'crypto';
import logger from '../config/logger.js';

// Use a secure key from env or fallback for dev (32 bytes for AES-256)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012'; 
const IV_LENGTH = 16; // For AES, this is always 16

export const encrypt = (text) => {
    if (!text) return text;
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (error) {
        logger.error('Encryption Failed', error);
        return text; // Fallback (or throw)
    }
};

export const decrypt = (text) => {
    if (!text) return text;
    try {
        const textParts = text.split(':');
        // If not encrypted format, return as is (backward compatibility)
        if (textParts.length !== 2) return text;

        const iv = Buffer.from(textParts[0], 'hex');
        const encryptedText = Buffer.from(textParts[1], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (error) {
        // logger.error('Decryption Failed', error);
        // Fail silently or return original text if decryption fails (e.g. key changed or not encrypted)
        return text;
    }
};

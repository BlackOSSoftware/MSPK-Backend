import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import Setting from '../models/Setting.js';
import logger from '../config/logger.js';

import { encrypt } from '../utils/encryption.js';

const SENSITIVE_KEYS = ['data_feed_api_key', 'data_feed_api_secret', 'data_feed_access_token', 'kite_api_secret', 'kite_access_token', 'alltick_api_key'];

const getSettings = catchAsync(async (req, res) => {
    // Return all or filter by keys if needed
    
    const settings = await Setting.find({});
    // Transform to simple object: { key: value }
    const settingsMap = settings.reduce((acc, curr) => {
        // Mask sensitive keys
        if (SENSITIVE_KEYS.includes(curr.key) && curr.value) {
            acc[curr.key] = '********'; // Masked Value
        } else {
            acc[curr.key] = curr.value;
        }
        return acc;
    }, {});

    res.send(settingsMap);
});

const updateSetting = catchAsync(async (req, res) => {
    const { key, value } = req.body;
    let finalValue = value;

    // Encrypt if sensitive
    if (SENSITIVE_KEYS.includes(key)) {
        if (value === '********') return res.send({ message: 'Ignored masked value' }); // Do not update
        finalValue = encrypt(value);
    }
    
    // Upsert
    const setting = await Setting.findOneAndUpdate(
        { key },
        { value: finalValue },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    
    logger.info(`Setting updated: ${key} by User ${req.user.id}`);
    res.send(setting);
});

const updateBulkSettings = catchAsync(async (req, res) => {
    const updates = req.body; // Expect { key1: val1, key2: val2 }

    const promises = Object.keys(updates).map(async (key) => {
        let value = updates[key];

        if (SENSITIVE_KEYS.includes(key)) {
            // If masked value sent back, ignore this key
            if (value === '********' || value === '') return; 
            value = encrypt(value);
        }

        return Setting.findOneAndUpdate(
            { key },
            { value: value },
            { new: true, upsert: true }
        );
    });

    await Promise.all(promises);

    // Reload Market Data Config
    try {
        const marketDataService = (await import('../services/marketData.service.js')).default;
        await marketDataService.loadSettings();
        logger.info('Market Data Settings Reloaded');
    } catch (error) {
        logger.error('Failed to reload market data settings', error);
    }

    res.send({ message: 'Settings updated successfully' });
});

export default {
    getSettings,
    updateSetting,
    updateBulkSettings
};

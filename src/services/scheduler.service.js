import cron from 'node-cron';
import { economicService } from './economic.service.js';
import notificationService from './notification.service.js';
import logger from '../config/log.js';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import Announcement from '../models/Announcement.js';
import marketDataService from './marketData.service.js';

const initScheduler = () => {
    logger.info('Initializing Scheduler Service...');

    // Task 1: Fetch Economic Events Daily at 00:00
    cron.schedule('0 0 * * *', async () => {
        logger.info('Running Daily Economic Event Fetch...');
        const today = new Date();
        const pastDate = new Date(today);
        pastDate.setDate(today.getDate() - 7);
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        
        const from = pastDate.toISOString().split('T')[0];
        const to = nextWeek.toISOString().split('T')[0];
        
        await economicService.fetchAndStoreEvents(from, to);
    });

    // Task 2: Check for High Impact Alerts every minute
    cron.schedule('* * * * *', async () => {
        // logger.info('Checking for economic alerts...'); // verbose, keep commented or debug
        await economicService.checkAndTriggerAlerts();
    });

    // Task 3: Check for Plan Expiry Reminders (Daily at 10:00 AM)
    cron.schedule('0 10 * * *', async () => {
        logger.info('Running Daily Plan Expiry Check...');
        try {
            // Get Plan Validity Settings
            const setting = await Setting.findOne({ key: 'planValidity' });
            // Default to 3 days if settings or value missing
            const daysBefore = (setting && setting.value && setting.value.preExpiryDays) 
                ? parseInt(setting.value.preExpiryDays) 
                : 3;

            const targetDateStart = new Date();
            targetDateStart.setDate(targetDateStart.getDate() + daysBefore);
            targetDateStart.setHours(0, 0, 0, 0);

            const targetDateEnd = new Date(targetDateStart);
            targetDateEnd.setHours(23, 59, 59, 999);

            // Find users expiring on this target date
            const users = await User.find({
                'subscription.expiresAt': {
                    $gte: targetDateStart,
                    $lte: targetDateEnd
                },
                status: 'Active'
            });

            if (users.length > 0) {
                logger.info(`Found ${users.length} users for renewal reminder.`);
                
                // Create System Announcement to log this event
                await Announcement.create({
                    title: `Renewal Reminders Sent (${daysBefore} Days Pre-Expiry)`,
                    message: `Reminders sent to ${users.length} users expiring on ${targetDateStart.toDateString()}.\nUsers: ${users.map(u => u.name).join(', ')}`,
                    type: 'REMINDER',
                    priority: 'HIGH',
                    targetAudience: { role: 'all' }, // Visible to Admins mostly
                    status: 'Active',
                    isNotificationSent: true // Silent Log (Don't broadcast to users)
                });

                // Trigger actual Push/Email Notification Service here for each user
                for (const user of users) {
                    await notificationService.sendPlanExpiryReminder(user, daysBefore);
                }
            } else {
                logger.info('No users found for renewal reminder today.');
            }
        } catch (error) {
            logger.error('Error in Plan Expiry Scheduler:', error);
        }
    });

    // Task 4: Check for Scheduled Announcements becoming Active (Every Minute)
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            const announcements = await Announcement.find({
                isActive: true,
                isNotificationSent: false,
                startDate: { $lte: now }
            });

            for (const ann of announcements) {
                logger.info(`Triggering Scheduled Announcement Broadcast: ${ann.title}`);
                await notificationService.scheduleAnnouncementNotifications(ann);
                ann.isNotificationSent = true;
                await ann.save();
            }
        } catch (error) {
            logger.error('Error in Scheduled Announcement Trigger:', error);
        }
    });

    // Task 5: Daily Kite Instrument Sync (8:00 AM IST)
    cron.schedule('0 8 * * *', async () => {
        logger.info('Running Daily Kite Instrument Sync...');
        try {
            await marketDataService.syncInstruments();
            logger.info('Daily Kite Instrument Sync completed.');
        } catch (error) {
            logger.error('Daily Kite Instrument Sync failed:', error);
        }
    });

    // Initial fetch on startup (optional, maybe check if empty?)
    // Initial fetch on startup
    setTimeout(async () => {
        logger.info('Running Startup Economic Event Fetch...');
        const today = new Date();
        const pastDate = new Date(today);
        pastDate.setDate(today.getDate() - 7);
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        
        const from = pastDate.toISOString().split('T')[0];
        const to = nextWeek.toISOString().split('T')[0];
        
        await economicService.fetchAndStoreEvents(from, to);
    }, 5000); // Run 5s after startup
};

export default {
    initScheduler
};

import cron from 'node-cron';
import { economicService } from './economic.service.js';
import notificationService from './notification.service.js';
import logger from '../config/log.js';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import Announcement from '../models/Announcement.js';
import marketDataService from './marketData.service.js';
import signalService from './signal.service.js';

const SCHEDULER_TIMEZONE = process.env.SCHEDULER_TIMEZONE || 'Asia/Kolkata';
const ECONOMIC_ALERT_CRON = process.env.CRON_ECONOMIC_ALERT || '* * * * *';
const ECONOMIC_DAILY_SUMMARY_CRON = process.env.CRON_ECONOMIC_DAILY_SUMMARY || '0 10 * * *';
const ANNOUNCEMENT_SCAN_CRON = process.env.CRON_ANNOUNCEMENT_SCAN || '* * * * *';
const ACTIVE_SIGNAL_RECONCILE_INTERVAL_MS = Math.max(
    15000,
    Number.parseInt(process.env.ACTIVE_SIGNAL_RECONCILE_INTERVAL_MS || '30000', 10) || 30000
);

const yieldToEventLoop = () =>
    new Promise((resolve) => {
        if (global.setImmediate) {
            setImmediate(resolve);
            return;
        }
        setTimeout(resolve, 0);
    });

const runInBatches = async (items, batchSize, handler) => {
    for (let index = 0; index < items.length; index += batchSize) {
        const batch = items.slice(index, index + batchSize);
        await Promise.allSettled(batch.map((item) => handler(item)));
        await yieldToEventLoop();
    }
};

const withCronGuard = (taskName, handler) => {
    let isRunning = false;

    return async () => {
        if (isRunning) {
            logger.warn(`[CRON] ${taskName} skipped because previous run is still in progress`);
            return;
        }

        const startedAt = Date.now();
        isRunning = true;

        try {
            await handler();
        } catch (error) {
            logger.error(`[CRON] ${taskName} failed`, error);
        } finally {
            isRunning = false;
            const durationMs = Date.now() - startedAt;
            if (durationMs >= 30000) {
                logger.warn(`[CRON] ${taskName} finished in ${durationMs}ms`);
            }
        }
    };
};

const scheduleCron = (taskName, expression, handler, options = {}) => {
    const timezone = options.timezone || SCHEDULER_TIMEZONE;
    cron.schedule(
        expression,
        withCronGuard(taskName, handler),
        {
            timezone,
            noOverlap: true,
            ...options,
        }
    );

    logger.info(`[CRON] Scheduled ${taskName} -> "${expression}" (${timezone})`);
};

const scheduleIntervalTask = (taskName, intervalMs, handler, options = {}) => {
    const guardedHandler = withCronGuard(taskName, handler);
    const run = () => {
        guardedHandler().catch((error) => {
            logger.error(`[INTERVAL] ${taskName} failed`, error);
        });
    };

    const timer = setInterval(run, intervalMs);
    if (typeof timer.unref === 'function') {
        timer.unref();
    }

    logger.info(`[INTERVAL] Scheduled ${taskName} every ${intervalMs}ms`);

    if (options.runOnStart !== false) {
        const startDelayMs = Number.isFinite(options.startDelayMs) ? options.startDelayMs : Math.min(intervalMs, 5000);
        setTimeout(run, startDelayMs);
    }

    return timer;
};

const initScheduler = () => {
    logger.info('Initializing Scheduler Service...');

    // Task 1: Fetch Economic Events Daily at 00:00
    scheduleCron('economic-events-sync', '0 0 * * *', async () => {
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
    scheduleCron('economic-alert-check', ECONOMIC_ALERT_CRON, async () => {
        // logger.info('Checking for economic alerts...'); // verbose, keep commented or debug
        await economicService.checkAndTriggerAlerts();
    });

    // Task 2.5: Send today's high-impact economic summary daily at 10:00 AM IST
    scheduleCron('economic-daily-summary', ECONOMIC_DAILY_SUMMARY_CRON, async () => {
        logger.info('Running Daily Economic Summary Broadcast...');
        await notificationService.sendDailyEconomicSummary();
    });

    // Task 3: Check for Plan Expiry Reminders (Daily at 10:00 AM)
    scheduleCron('plan-expiry-reminder', '0 10 * * *', async () => {
        logger.info('Running Daily Plan Expiry Check...');
        // Get Plan Validity Settings
        const setting = await Setting.findOne({ key: 'planValidity' }).lean();
        // Default to 3 days if settings or value missing
        const daysBefore = (setting && setting.value && setting.value.preExpiryDays)
            ? Number.parseInt(setting.value.preExpiryDays, 10)
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
        }).select('_id name subscription').lean();

        if (users.length > 0) {
            logger.info(`Found ${users.length} users for renewal reminder.`);

            const sampledNames = users.slice(0, 25).map((user) => user.name).filter(Boolean).join(', ');
            const extraUsers = users.length > 25 ? ` and ${users.length - 25} more` : '';

            // Create System Announcement to log this event
            await Announcement.create({
                title: `Renewal Reminders Sent (${daysBefore} Days Pre-Expiry)`,
                message: `Reminders sent to ${users.length} users expiring on ${targetDateStart.toDateString()}.\nUsers: ${sampledNames}${extraUsers}`,
                type: 'REMINDER',
                priority: 'HIGH',
                targetAudience: { role: 'all' }, // Visible to Admins mostly
                status: 'Active',
                isNotificationSent: true // Silent Log (Don't broadcast to users)
            });

            // Trigger actual Push/Email Notification Service in controlled batches
            await runInBatches(users, 25, async (user) => {
                await notificationService.sendPlanExpiryReminder(user, daysBefore);
            });
        } else {
            logger.info('No users found for renewal reminder today.');
        }
    });

    // Task 4: Check for Scheduled Announcements becoming Active (Every Minute)
    scheduleCron('scheduled-announcement-trigger', ANNOUNCEMENT_SCAN_CRON, async () => {
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
    });

    // Task 5: Daily Kite Instrument Sync (8:00 AM IST)
    scheduleCron('kite-instrument-sync', '0 8 * * *', async () => {
        logger.info('Running Daily Kite Instrument Sync...');
        await marketDataService.syncInstruments();
        logger.info('Daily Kite Instrument Sync completed.');
    });

    scheduleIntervalTask('active-signal-reconcile', ACTIVE_SIGNAL_RECONCILE_INTERVAL_MS, async () => {
        const result = await signalService.reconcileActiveSignalsWithMarketData({ limit: 500 });
        if (result.closedCount > 0) {
            logger.info(
                `[SIGNAL_RECONCILE] Auto-closed ${result.closedCount} active signals out of ${result.scannedCount} scanned`
            );
        }
    });

    // Initial fetch on startup (optional, maybe check if empty?)
    // Initial fetch on startup
    setTimeout(() => {
        withCronGuard('startup-economic-events-sync', async () => {
            logger.info('Running Startup Economic Event Fetch...');
            const today = new Date();
            const pastDate = new Date(today);
            pastDate.setDate(today.getDate() - 7);
            const nextWeek = new Date(today);
            nextWeek.setDate(today.getDate() + 7);

            const from = pastDate.toISOString().split('T')[0];
            const to = nextWeek.toISOString().split('T')[0];

            await economicService.fetchAndStoreEvents(from, to);
        })().catch((error) => {
            logger.error('Startup Economic Event Fetch failed:', error);
        });
    }, 5000); // Run 5s after startup
};

export default {
    initScheduler
};

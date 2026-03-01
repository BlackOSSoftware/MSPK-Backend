import axios from 'axios';
import logger from '../config/log.js';
import EconomicEvent from '../models/EconomicEvent.js';
import notificationService from './notification.service.js';

class EconomicService {
    constructor() {
        this.apiKey = null;
        this.cache = {
            data: null,
            lastFetch: 0
        };
        // Cache duration: 1 Hour (Free tier limit is 250 calls/day, so 1 call/hr is safe)
        this.CACHE_DURATION = 60 * 60 * 1000; 
        this.baseUrl = 'https://financialmodelingprep.com/api/v3';
    }

    initialize(apiKey) {
        this.apiKey = apiKey;
        if (!this.apiKey) {
            logger.warn('ECONOMIC: No FMP API Key provided. Calendar disabled.');
        } else {
            logger.info('ECONOMIC: Service Initialized');
        }
    }

    /**
     * Get Events from Database (Filtered)
     */
    async getEvents(filter = {}) {
        const query = {};
        if (filter.from && filter.to) {
            const toDate = new Date(filter.to);
            toDate.setHours(23, 59, 59, 999);
            query.date = { 
                $gte: new Date(filter.from), 
                $lte: toDate
            };
        } else if (filter.from) {
             query.date = { $gte: new Date(filter.from) };
        }
        
        // Return latest events from DB
        return await EconomicEvent.find(query).sort({ date: 1 });
    }

    /**
     * Fetch Economic Calendar Events from API
     * @param {string} from - YYYY-MM-DD (Optional)
     * @param {string} to - YYYY-MM-DD (Optional)
     */
    async getCalendar(from, to) {
        if (!this.apiKey) return [];

        // Check Cache (Simple global cache for 'today' largely)
        const now = Date.now();
        if (this.cache.data && (now - this.cache.lastFetch < this.CACHE_DURATION) && !from) {
             logger.info('ECONOMIC: Serving from Cache');
             return this.cache.data;
        }

        try {
            // FIXED: Use correct FMP stable endpoint
            const baseUrl = 'https://financialmodelingprep.com/stable';
            
            // Build query parameters
            const params = new URLSearchParams();
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            params.append('apikey', this.apiKey);
            
            const url = `${baseUrl}/economic-calendar?${params.toString()}`;

            logger.info(`ECONOMIC: Fetching ${url.replace(this.apiKey, 'API_KEY')}`);
            const response = await axios.get(url);
            const data = response.data;

            // Map to cleaner internal format (Matching EconomicEvent Model)
            // FMP stable API response format: { date, country, event, currency, previous, estimate, actual, change, impact, changePercentage }
            const events = data.map(e => ({
                event: e.event,
                date: e.date,
                country: e.country,
                impact: e.impact, 
                actual: e.actual,
                previous: e.previous,
                forecast: e.estimate, // FMP uses 'estimate' instead of 'forecast'
                currency: e.currency,
                unit: e.unit || null, // May not always be present
                change: e.change,
                changePercentage: e.changePercentage
            }));

            // Update Cache (only if default query)
            if (!from) {
                this.cache.data = events;
                this.cache.lastFetch = now;
            }

            return events;

        } catch (error) {
            logger.error('ECONOMIC: Failed to fetch calendar', error.message);
            return this.cache.data || []; 
        }
    }

    /**
     * Fetch from FMP and Sync with DB
     */
    async fetchAndStoreEvents(from, to) {
        if (!this.apiKey) return;
        logger.info(`ECONOMIC: Syncing events from ${from} to ${to}...`);
        
        const events = await this.getCalendar(from, to);
        if (!events || events.length === 0) return;

        let upsertCount = 0;
        for (const e of events) {
            const eventId = `${e.date}_${e.country}_${e.event}`.replace(/\s+/g, '_');
            
            await EconomicEvent.findOneAndUpdate(
                { eventId },
                {
                    ...e,
                    eventId,
                    date: new Date(e.date)
                },
                { upsert: true, new: true }
            );
            upsertCount++;
        }
        logger.info(`ECONOMIC: Synced ${upsertCount} events to Database.`);
    }

    /**
     * Check for High Impact events and trigger notifications
     * Sends alerts 30 minutes before event
     */
    async checkAndTriggerAlerts() {
        try {
            const now = new Date();
            const alertWindow = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes window

            // Find High Impact events in the next 30 mins that haven't been alerted
            const pendingEvents = await EconomicEvent.find({
                impact: 'High',
                date: { $gte: now, $lte: alertWindow },
                isAlertSent: false
            });

            if (pendingEvents.length === 0) return;

            logger.info(`ECONOMIC: Found ${pendingEvents.length} high-impact events for alert.`);

            for (const event of pendingEvents) {
                try {
                    // Send alert to all users via notification service
                    await notificationService.sendEconomicAlert({
                        event: event.event,
                        country: event.country,
                        currency: event.currency,
                        impact: event.impact,
                        date: event.date,
                        actual: event.actual,
                        forecast: event.forecast,
                        previous: event.previous
                    });

                    // Mark as alerted
                    event.isAlertSent = true;
                    await event.save();

                    logger.info(`ECONOMIC: Alert sent for ${event.event} (${event.currency})`);

                } catch (eventError) {
                    logger.error(`ECONOMIC: Failed to send alert for ${event.event}:`, eventError.message);
                }
            }

            logger.info(`ECONOMIC: Completed alert check - ${pendingEvents.length} alerts sent`);

        } catch (error) {
            logger.error('ECONOMIC: Alert check failed', error);
        }
    }
}

export const economicService = new EconomicService();

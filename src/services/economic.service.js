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
        this.publicCalendarCache = {
            data: null,
            lastFetch: 0,
            months: new Map(),
        };
        this.isAlertCheckRunning = false;
        // Cache duration: 1 Hour (Free tier limit is 250 calls/day, so 1 call/hr is safe)
        this.CACHE_DURATION = 60 * 60 * 1000; 
        this.baseUrl = 'https://financialmodelingprep.com/api/v3';
    }

    getMonthKey(date = new Date()) {
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const parsed = date instanceof Date ? new Date(date) : new Date(date);
        if (Number.isNaN(parsed.getTime())) return '';
        return `${monthNames[parsed.getMonth()]}.${parsed.getFullYear()}`;
    }

    getMonthKeysForRange(filter = {}) {
        const start = filter.from ? new Date(filter.from) : new Date();
        const end = filter.to ? new Date(filter.to) : new Date(start);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return [this.getMonthKey(new Date())].filter(Boolean);
        }

        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setDate(1);
        end.setHours(0, 0, 0, 0);

        const keys = [];
        const cursor = new Date(start);
        while (cursor.getTime() <= end.getTime() && keys.length < 12) {
            const key = this.getMonthKey(cursor);
            if (key) keys.push(key);
            cursor.setMonth(cursor.getMonth() + 1, 1);
        }

        return keys.length > 0 ? keys : [this.getMonthKey(new Date())].filter(Boolean);
    }

    extractForexFactoryDays(html = '') {
        const marker = 'days:';
        const markerIndex = String(html).indexOf(marker);
        if (markerIndex === -1) return [];

        const startIndex = html.indexOf('[', markerIndex);
        if (startIndex === -1) return [];

        let depth = 0;
        let inString = false;
        let isEscaped = false;
        let endIndex = -1;

        for (let index = startIndex; index < html.length; index += 1) {
            const char = html[index];

            if (inString) {
                if (isEscaped) {
                    isEscaped = false;
                    continue;
                }
                if (char === '\\') {
                    isEscaped = true;
                    continue;
                }
                if (char === '"') {
                    inString = false;
                }
                continue;
            }

            if (char === '"') {
                inString = true;
                continue;
            }

            if (char === '[') {
                depth += 1;
                continue;
            }

            if (char === ']') {
                depth -= 1;
                if (depth === 0) {
                    endIndex = index;
                    break;
                }
            }
        }

        if (endIndex === -1) return [];

        try {
            return JSON.parse(html.slice(startIndex, endIndex + 1));
        } catch (error) {
            logger.error('ECONOMIC: Failed to parse ForexFactory fallback payload', error.message);
            return [];
        }
    }

    mapForexFactoryEvent(day = {}, event = {}) {
        const timestamp = Number(event?.dateline);
        const eventDate = Number.isFinite(timestamp) ? new Date(timestamp * 1000) : new Date(event?.date || day?.date);
        if (Number.isNaN(eventDate.getTime())) return null;

        const impactRaw = String(event?.impactName || '').trim().toLowerCase();
        const normalizedImpact = impactRaw
            ? impactRaw.charAt(0).toUpperCase() + impactRaw.slice(1)
            : 'None';

        return {
            eventId: `ffx_${String(event?.id || `${event?.currency || 'NA'}_${event?.name || event?.event || eventDate.toISOString()}`)}`,
            date: eventDate,
            country: event?.country || event?.currency || '',
            currency: event?.currency || '',
            event: event?.name || event?.event || '',
            impact: ['Low', 'Medium', 'High', 'None'].includes(normalizedImpact) ? normalizedImpact : 'None',
            actual: event?.actual ?? '',
            forecast: event?.forecast ?? '',
            previous: event?.previous ?? '',
            unit: null,
            isAlertSent: false,
        };
    }

    async fetchForexFactoryMonthEvents(monthKey) {
        const normalizedKey = String(monthKey || '').trim().toLowerCase();
        if (!normalizedKey) return [];

        const cached = this.publicCalendarCache.months.get(normalizedKey);
        const now = Date.now();
        if (cached && now - cached.lastFetch < 60 * 60 * 1000) {
            return cached.data;
        }

        try {
            const response = await axios.get(`https://secure.forexfactory.com/calendar?month=${normalizedKey}`, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                },
            });

            const days = this.extractForexFactoryDays(response.data);
            const events = days
                .flatMap((day) => (Array.isArray(day?.events) ? day.events.map((event) => this.mapForexFactoryEvent(day, event)) : []))
                .filter(Boolean);

            this.publicCalendarCache.months.set(normalizedKey, {
                data: events,
                lastFetch: now,
            });

            return events;
        } catch (error) {
            logger.error(`ECONOMIC: ForexFactory month fallback failed for ${normalizedKey}`, error.message);
            return [];
        }
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
    async getEvents(filter = {}, options = {}) {
        const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
        const limit = [10, 20].includes(Number.parseInt(options.limit, 10))
            ? Number.parseInt(options.limit, 10)
            : 10;
        const query = this.buildEventQuery(filter);

        let totalResults = await EconomicEvent.countDocuments(query);
        let totalPages = Math.max(1, Math.ceil(totalResults / limit));
        let skip = (page - 1) * limit;
        let results = await EconomicEvent.find(query)
            .sort({ date: 1 })
            .skip(skip)
            .limit(limit);

        if (totalResults > 0) {
            return {
                results,
                page,
                limit,
                totalPages,
                totalResults,
            };
        }

        if (filter.from || filter.to) {
            await this.fetchAndStoreEvents(filter.from, filter.to);
            totalResults = await EconomicEvent.countDocuments(query);
            totalPages = Math.max(1, Math.ceil(totalResults / limit));
            skip = (page - 1) * limit;
            results = await EconomicEvent.find(query)
                .sort({ date: 1 })
                .skip(skip)
                .limit(limit);

            if (totalResults > 0) {
                return {
                    results,
                    page,
                    limit,
                    totalPages,
                    totalResults,
                };
            }
        }

        const fallbackResults = await this.getPublicFallbackEvents(filter);
        return this.paginateEvents(fallbackResults, page, limit);
    }

    buildEventQuery(filter = {}) {
        const query = {};

        if (filter.from || filter.to) {
            query.date = {};

            if (filter.from) {
                const fromDate = new Date(filter.from);
                fromDate.setHours(0, 0, 0, 0);
                query.date.$gte = fromDate;
            }

            if (filter.to) {
                const toDate = new Date(filter.to);
                toDate.setHours(23, 59, 59, 999);
                query.date.$lte = toDate;
            }
        }

        if (filter.impact) {
            const normalizedImpact = String(filter.impact).toLowerCase();
            if (normalizedImpact === 'important') {
                query.impact = 'High';
            } else if (['low', 'medium', 'high', 'none'].includes(normalizedImpact)) {
                query.impact = normalizedImpact.charAt(0).toUpperCase() + normalizedImpact.slice(1);
            }
        }

        return query;
    }

    paginateEvents(events = [], page = 1, limit = 10) {
        const totalResults = Array.isArray(events) ? events.length : 0;
        const totalPages = Math.max(1, Math.ceil(totalResults / limit));
        const normalizedPage = Math.min(Math.max(page, 1), totalPages);
        const skip = (normalizedPage - 1) * limit;
        const results = (Array.isArray(events) ? events : []).slice(skip, skip + limit);

        return {
            results,
            page: normalizedPage,
            limit,
            totalPages,
            totalResults,
        };
    }

    mapPublicFallbackEvent(rawEvent = {}) {
        const eventDate = new Date(rawEvent.date);
        if (Number.isNaN(eventDate.getTime())) return null;

        const impactRaw = String(rawEvent.impact || 'None').trim().toLowerCase();
        const normalizedImpact = impactRaw
            ? impactRaw.charAt(0).toUpperCase() + impactRaw.slice(1)
            : 'None';

        return {
            eventId: `ff_${String(rawEvent.date || '')}_${String(rawEvent.country || '')}_${String(rawEvent.title || '')}`.replace(/\s+/g, '_'),
            date: eventDate,
            country: rawEvent.country || '',
            currency: rawEvent.country || '',
            event: rawEvent.title || rawEvent.event || '',
            impact: ['Low', 'Medium', 'High', 'None'].includes(normalizedImpact) ? normalizedImpact : 'None',
            actual: rawEvent.actual ?? '',
            forecast: rawEvent.forecast ?? '',
            previous: rawEvent.previous ?? '',
            unit: rawEvent.unit ?? null,
            isAlertSent: false,
        };
    }

    async getPublicFallbackEvents(filter = {}) {
        const monthKeys = this.getMonthKeysForRange(filter);
        const monthEvents = [];

        for (const monthKey of monthKeys) {
            const events = await this.fetchForexFactoryMonthEvents(monthKey);
            if (events.length > 0) {
                monthEvents.push(...events);
            }
        }

        if (monthEvents.length > 0) {
            const dedupedEvents = Array.from(
                new Map(monthEvents.map((event) => [String(event.eventId || `${event.date}_${event.event}`), event])).values()
            );
            return this.filterPublicFallbackEvents(dedupedEvents, filter);
        }

        const now = Date.now();
        if (Array.isArray(this.publicCalendarCache.data) && now - this.publicCalendarCache.lastFetch < 60 * 1000) {
            return this.filterPublicFallbackEvents(this.publicCalendarCache.data, filter);
        }

        try {
            const response = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
                timeout: 15000,
            });
            const rawEvents = Array.isArray(response.data) ? response.data : [];
            const mappedEvents = rawEvents
                .map((item) => this.mapPublicFallbackEvent(item))
                .filter(Boolean)
                .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());

            this.publicCalendarCache = {
                data: mappedEvents,
                lastFetch: now,
            };

            return this.filterPublicFallbackEvents(mappedEvents, filter);
        } catch (error) {
            logger.error('ECONOMIC: Public fallback fetch failed', error.message);
            return [];
        }
    }

    filterPublicFallbackEvents(events = [], filter = {}) {
        const fromDate = filter.from ? new Date(filter.from) : null;
        const toDate = filter.to ? new Date(filter.to) : null;
        if (fromDate) fromDate.setHours(0, 0, 0, 0);
        if (toDate) toDate.setHours(23, 59, 59, 999);

        const normalizedImpact = String(filter.impact || '').trim().toLowerCase();

        return (Array.isArray(events) ? events : [])
            .filter((event) => {
                const eventDate = new Date(event.date);
                if (Number.isNaN(eventDate.getTime())) return false;
                if (fromDate && eventDate.getTime() < fromDate.getTime()) return false;
                if (toDate && eventDate.getTime() > toDate.getTime()) return false;
                if (!normalizedImpact || normalizedImpact === 'all') return true;

                if (normalizedImpact === 'important') {
                    return String(event.impact || '').toLowerCase() === 'high';
                }

                return String(event.impact || '').toLowerCase() === normalizedImpact;
            })
            .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
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

        const operations = [];
        for (const event of events) {
            const eventDate = new Date(event.date);
            if (Number.isNaN(eventDate.getTime())) continue;

            const eventId = `${event.date}_${event.country}_${event.event}`.replace(/\s+/g, '_');
            operations.push({
                updateOne: {
                    filter: { eventId },
                    update: {
                        $set: {
                            ...event,
                            eventId,
                            date: eventDate
                        }
                    },
                    upsert: true
                }
            });
        }

        if (operations.length === 0) {
            logger.info('ECONOMIC: No valid events to sync.');
            return;
        }

        const CHUNK_SIZE = 500;
        let upsertCount = 0;

        for (let index = 0; index < operations.length; index += CHUNK_SIZE) {
            const chunk = operations.slice(index, index + CHUNK_SIZE);
            await EconomicEvent.bulkWrite(chunk, { ordered: false });
            upsertCount += chunk.length;
        }

        logger.info(`ECONOMIC: Synced ${upsertCount} events to Database.`);
    }

    /**
     * Check for High Impact events and trigger notifications
     * Sends alerts 30 minutes before event
     */
    async checkAndTriggerAlerts() {
        if (this.isAlertCheckRunning) {
            logger.warn('ECONOMIC: Previous alert check still running, skipping overlap.');
            return;
        }

        this.isAlertCheckRunning = true;

        try {
            const now = new Date();
            const alertWindow = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes window

            // Find High Impact events in the next 30 mins that haven't been alerted
            const pendingEvents = await EconomicEvent.find({
                impact: 'High',
                date: { $gte: now, $lte: alertWindow },
                isAlertSent: false
            }).select('_id event country currency impact date actual forecast previous').lean();

            if (pendingEvents.length === 0) return;

            logger.info(`ECONOMIC: Found ${pendingEvents.length} high-impact events for alert.`);

            const alertedEventIds = [];
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

                    alertedEventIds.push(event._id);

                    logger.info(`ECONOMIC: Alert sent for ${event.event} (${event.currency})`);

                } catch (eventError) {
                    logger.error(`ECONOMIC: Failed to send alert for ${event.event}:`, eventError.message);
                }
            }

            if (alertedEventIds.length > 0) {
                await EconomicEvent.updateMany(
                    { _id: { $in: alertedEventIds } },
                    { $set: { isAlertSent: true } }
                );
            }

            logger.info(`ECONOMIC: Completed alert check - ${pendingEvents.length} alerts sent`);

        } catch (error) {
            logger.error('ECONOMIC: Alert check failed', error);
        } finally {
            this.isAlertCheckRunning = false;
        }
    }
}

export const economicService = new EconomicService();

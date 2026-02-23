import requestQueue from '../utils/requestQueue.js';
import allTickService from './alltick.service.js';
import logger from '../config/logger.js';

class StartupOptimizer {
    constructor() {
        this.phases = {
            1: { name: 'ESSENTIAL', delay: 0, priority: 1, limit: 2 },
            2: { name: 'IMPORTANT', delay: 5000, priority: 2, limit: 5 },
            3: { name: 'BACKGROUND', delay: 30000, priority: 3, limit: 3 } // Batch 3
        };
        
        // Configuration
        this.timeframes = {
            phase1: ['5', '15', '60'],
            phase2: ['30', '240'], 
            phase3: ['D']
        };
    }

    /**
     * Start the Optimized Startup Sequence
     * @param {Object} marketDataService - Reference to main service
     */
    async start(marketDataService) {
        logger.info('[StartupOptimizer] Starting Smart Sequence...');
        
        const allSymbols = Object.keys(marketDataService.symbols || {});
        
        // 1. Identify Groups
        const dashboardSymbols = ['BTCUSD', 'XAUUSD', 'NSE:NIFTY 50-INDEX', 'NSE:NIFTY BANK-INDEX']; // Max 2 effectively
        const watchlistSymbols = allSymbols.filter(s => !dashboardSymbols.includes(s)).slice(0, 5); // Mock 'Watchlist'
        const backgroundSymbols = allSymbols.filter(s => !dashboardSymbols.includes(s) && !watchlistSymbols.includes(s));

        // --- Phase 1: ESSENTIAL (0s) ---
        await this._processPhase(1, dashboardSymbols, this.timeframes.phase1, marketDataService);

        // --- Phase 2: IMPORTANT (5s) ---
        setTimeout(() => {
            this._processPhase(2, watchlistSymbols, this.timeframes.phase2, marketDataService);
        }, this.phases[2].delay);

        // --- Phase 3: BACKGROUND (30s+) ---
        setTimeout(() => {
             this._processBackground(backgroundSymbols, marketDataService);
        }, this.phases[3].delay);
    }

    async _processPhase(phaseId, symbols, tfs, service) {
        const config = this.phases[phaseId];
        logger.info(`[StartupOptimizer] Phase ${phaseId} (${config.name}): Fetching ${symbols.length} symbols`);

        // Limit concurrent symbols? RequestQueue handles it, but we can limit here to be safe.
        const limitedSymbols = symbols.slice(0, config.limit);

        for (const symbol of limitedSymbols) {
            for (const tf of tfs) {
                this._fetchSafe(symbol, tf, config.priority, service);
            }
        }
    }

    async _processBackground(symbols, service) {
        logger.info(`[StartupOptimizer] Phase 3 (BACKGROUND): Queuing ${symbols.length} symbols...`);
        
        // Batch processing with delays
        const batchSize = this.phases[3].limit;
        const tfs = this.timeframes.phase3;

        for (let i = 0; i < symbols.length; i += batchSize) {
            const batch = symbols.slice(i, i + batchSize);
            
            // Stagger batches by 2 seconds
            setTimeout(() => {
                batch.forEach(symbol => {
                    tfs.forEach(tf => {
                         this._fetchSafe(symbol, tf, 3, service);
                    });
                });
            }, (i / batchSize) * 2000);
        }
    }

    async _fetchSafe(symbol, tf, priority, service) {
        // Calculate 'from' based on TF (e.g. last 100 candles)
        // Simplified: Fetch last 24h or 7d?
        // Prompt says "Minimizes initial API calls".
        // Let's rely on getHistory default range logic or provide a smart range.
        
        // Smart Range:
        const now = Math.floor(Date.now() / 1000);
        let duration = 86400 * 2; // 2 Days default
        if (tf === 'D') duration = 86400 * 30; // 30 Days
        
        const from = new Date((now - duration) * 1000);
        const to = new Date(now * 1000);

        try {
            await service.getHistory(symbol, tf, from, to);
        } catch (e) {
            // Emergency Brake
            if (e.response && e.response.status === 429) {
                logger.warn(`[StartupOptimizer] 429 Detected on ${symbol}. ACTIVATING EMERGENCY BRAKE.`);
                requestQueue.pause(60000); // 60s Pause
            }
        }
    }
}

export default new StartupOptimizer();

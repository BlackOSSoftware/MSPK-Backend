import fs from 'fs';
import path from 'path';
import { kiteService } from './kite.service.js';
import logger from '../config/log.js';
import MasterSymbol from '../models/MasterSymbol.js';

const INSTRUMENTS_FILE = path.join(process.cwd(), 'data', 'kite_instruments.json');

class KiteInstrumentsService {
    constructor() {
        this.instruments = null;
        this.instrumentMap = new Map(); // token -> symbol
        this.symbolMap = new Map();     // symbol -> instrument object
    }

    /**
     * Sync instruments from Zerodha and save locally
     */
    async syncFromZerodha() {
        try {
            logger.info('KITE_SYNC: Starting daily instrument sync...');
            
            // Ensure data directory exists
            const dataDir = path.dirname(INSTRUMENTS_FILE);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            const instruments = await kiteService.getInstruments();
            if (!instruments || instruments.length === 0) {
                throw new Error('Received empty instrument list from Zerodha');
            }

            // Save to local file system for fast loading (avoid bloating MongoDB unnecessarily)
            fs.writeFileSync(INSTRUMENTS_FILE, JSON.stringify(instruments));
            
            logger.info(`KITE_SYNC: Successfully synced ${instruments.length} instruments to ${INSTRUMENTS_FILE}`);
            
            // Reload into memory
            await this.loadIntoMemory();
            
            return { count: instruments.length };
        } catch (error) {
            logger.error(`KITE_SYNC: Sync failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Load instruments from local file into memory maps
     */
    async loadIntoMemory() {
        try {
            if (!fs.existsSync(INSTRUMENTS_FILE)) {
                logger.warn('KITE_SYNC: No local instrument file found. Sync required.');
                return;
            }

            logger.info('KITE_SYNC: Loading instruments into memory...');
            const data = fs.readFileSync(INSTRUMENTS_FILE, 'utf8');
            const instruments = JSON.parse(data);

            this.instrumentMap.clear();
            this.symbolMap.clear();

            for (const inst of instruments) {
                // We use EXCHANGE:SYMBOL format for consistency
                const fullSymbol = `${inst.exchange}:${inst.tradingsymbol}`;
                this.instrumentMap.set(inst.instrument_token.toString(), fullSymbol);
                this.symbolMap.set(fullSymbol, inst);
            }

            logger.info(`KITE_SYNC: Loaded ${this.instrumentMap.size} instruments into memory maps`);
        } catch (error) {
            logger.error(`KITE_SYNC: Failed to load instruments: ${error.message}`);
        }
    }

    /**
     * Get instrument details by full symbol (EXCHANGE:TRADINGSYMBOL)
     */
    getInstrumentBySymbol(symbol) {
        return this.symbolMap.get(symbol);
    }

    /**
     * Get full symbol by token
     */
    getSymbolByToken(token) {
        return this.instrumentMap.get(token.toString());
    }

    /**
     * Search instruments by query
     */
    /**
     * Search instruments by query
     */
    search(query, limit = 50) { // Increased limit
        const results = [];
        const q = query.toUpperCase();
        
        // Priority buckets
        const exactMatches = [];
        const startsWithMatches = [];
        const containsMatches = [];

        for (const [symbol, inst] of this.symbolMap.entries()) {
            // Optimization: Skip checking if we have enough, but we want quality results so we check all or meaningful subset
            // For performance on 100k+ items, we might need an index. But for 3-5k items loop is fine.
            // Kite has ~100k instruments. This loop might be heavy. 
            // We should trust the loop but break early if we have enough HIGH QUALITY matches.
            
            const s = symbol.toUpperCase();
            const n = (inst.name || '').toUpperCase();
            
            if (s.includes(q) || n.includes(q)) {
                // Formatting
                const item = {
                    symbol,
                    name: inst.name,
                    exchange: inst.exchange,
                    instrumentToken: inst.instrument_token,
                    segment: inst.segment,
                    lotSize: inst.lot_size,
                    tickSize: inst.tick_size
                };

                // Ranking Logic
                // 1. Exact Match on Trading Symbol
                if (inst.tradingsymbol === q) {
                    exactMatches.push(item);
                } 
                // 2. Exact Match on Name
                else if (inst.name.toUpperCase() === q) {
                    exactMatches.push(item);
                }
                // 3. Equity / Index Priority (NSE/BSE)
                else if (inst.segment === 'NSE' || inst.segment === 'BSE' || inst.segment === 'INDICES') {
                     if (s.startsWith(q)) startsWithMatches.push(item);
                     else containsMatches.push(item);
                }
                // 4. Closest Futures (Current Month)
                else if (inst.segment === 'NFO-FUT' || inst.segment === 'MCX-FUT') {
                     // Prioritize near month? Complex. Just treat as normal startsWith
                     if (s.startsWith(q)) startsWithMatches.push(item);
                     else containsMatches.push(item);
                }
                // 5. Rest
                else {
                    containsMatches.push(item);
                }
            }
        }

        // Combine and Slice
        // We want Exact -> StartsWith (Equity) -> StartsWith (Others) -> Contains
        // But the logic above grouped all StartsWith together.
        // Let's simplified sort:
        const sorted = [...exactMatches, ...startsWithMatches, ...containsMatches];
        return sorted.slice(0, limit);
    }
}

export const kiteInstrumentsService = new KiteInstrumentsService();
export default kiteInstrumentsService;

import { kiteService } from './kite.service.js';
import logger from '../config/log.js';
import MasterSymbol from '../models/MasterSymbol.js';
import { buildMasterSymbolId } from '../utils/masterSymbolId.js';
import { KITE_SYNC_SYMBOLS } from '../config/seedSymbols.js';
import { isCurrentMonthExpiry } from '../utils/currentMonthContracts.js';

const toUpper = (value) => String(value ?? '').trim().toUpperCase();

const stripSymbolSuffix = (value = '') => {
    let normalized = toUpper(value);
    if (normalized.endsWith('-INDEX')) {
        normalized = normalized.slice(0, -6);
    } else if (normalized.endsWith('-EQ')) {
        normalized = normalized.slice(0, -3);
    } else if (normalized.endsWith('.EQ')) {
        normalized = normalized.slice(0, -3);
    }
    return normalized;
};

const toKiteSymbol = (item = {}) => {
    const raw = toUpper(item.sourceSymbol || item.symbol);
    if (!raw) return null;

    let exchange = '';
    let trading = '';

    if (raw.includes(':')) {
        const parts = raw.split(':');
        exchange = toUpper(parts.shift());
        trading = toUpper(parts.join(':'));
    } else {
        exchange = toUpper(item.exchange || 'NSE');
        trading = raw;
    }

    trading = stripSymbolSuffix(trading);
    if (!exchange || !trading) return null;

    return `${exchange}:${trading}`;
};

const buildAllowMap = () => {
    const map = new Map();
    for (const item of KITE_SYNC_SYMBOLS || []) {
        const kiteSymbol = toKiteSymbol(item);
        if (!kiteSymbol) continue;
        map.set(kiteSymbol, item);
    }
    return map;
};

const FUTURE_CONTRACT_ROOT_REGEX = /^([A-Z0-9]+?)(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)FUT$/i;

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getFutureContractIdentity = (symbol = '') => {
    const normalized = toUpper(symbol);
    if (!normalized) return null;

    const parts = normalized.split(':');
    const exchange = parts.length > 1 ? toUpper(parts.shift()) : '';
    const tradingSymbol = parts.length > 0 ? toUpper(parts.join(':')) : normalized;
    const match = tradingSymbol.match(FUTURE_CONTRACT_ROOT_REGEX);
    if (!match) return null;

    return {
        exchange,
        root: match[1],
    };
};

const findExistingFrontMonthFutureDoc = async (payload = {}, referenceDate = new Date()) => {
    const stableSymbolId = buildMasterSymbolId(payload, { referenceDate });
    const identity = getFutureContractIdentity(payload.symbol);
    const filters = [{ symbol: payload.symbol }];

    if (stableSymbolId) {
        filters.unshift({ symbolId: stableSymbolId });
    }

    if (identity?.exchange && identity?.root) {
        filters.push({
            exchange: identity.exchange,
            segment: payload.segment || 'FNO',
            symbol: new RegExp(
                `^${escapeRegex(identity.exchange)}:${escapeRegex(identity.root)}\\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)FUT$`,
                'i'
            ),
        });
    }

    const candidates = await MasterSymbol.find({ $or: filters })
        .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
        .lean();

    if (candidates.length === 0) return null;

    const exactSymbol = candidates.find((candidate) => toUpper(candidate?.symbol) === toUpper(payload.symbol));
    if (exactSymbol) return exactSymbol;

    if (stableSymbolId) {
        const exactStableId = candidates.find((candidate) => toUpper(candidate?.symbolId) === toUpper(stableSymbolId));
        if (exactStableId) return exactStableId;
    }

    return candidates[0];
};

class KiteInstrumentsService {
    constructor() {
        this.instruments = null;
        this.instrumentMap = new Map(); // token -> symbol
        this.symbolMap = new Map();     // symbol -> instrument object
    }

    /**
     * Sync curated instruments from Zerodha and save to MongoDB
     */
    async syncFromZerodha() {
        try {
            logger.info('KITE_SYNC: Starting curated instrument sync...');

            const allowMap = buildAllowMap();
            if (allowMap.size === 0) {
                throw new Error('No allowed Kite symbols configured for sync');
            }

            const instruments = await kiteService.getInstruments();
            if (!Array.isArray(instruments) || instruments.length === 0) {
                throw new Error('Received empty instrument list from Zerodha');
            }

            let synced = 0;
            let nfoFuturesSynced = 0;
            const missing = new Set(allowMap.keys());
            const referenceDate = new Date();

            for (const inst of instruments) {
                const key = toUpper(`${inst.exchange}:${inst.tradingsymbol}`);
                const target = allowMap.get(key);
                if (!target) continue;

                missing.delete(key);

                const payload = {
                    symbol: toUpper(target.symbol),
                    name: target.name || inst.name || inst.tradingsymbol,
                    segment: target.segment || (inst.segment === 'INDICES' ? 'INDICES' : 'EQUITY'),
                    exchange: target.exchange || inst.exchange,
                    provider: target.provider || 'kite',
                    sourceSymbol: target.sourceSymbol || key,
                    lotSize: inst.lot_size || target.lotSize || 1,
                    tickSize: inst.tick_size || target.tickSize || 0.05,
                    instrumentToken: String(inst.instrument_token),
                    isActive: target.isActive !== undefined ? target.isActive : true,
                    isWatchlist: target.isWatchlist !== undefined ? target.isWatchlist : false,
                };

                const doc = await MasterSymbol.findOneAndUpdate(
                    { symbol: payload.symbol },
                    { $set: payload },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );

                const nextSymbolId = buildMasterSymbolId(doc, { referenceDate });
                if (doc.symbolId !== nextSymbolId) {
                    doc.symbolId = nextSymbolId;
                    await doc.save();
                }

                synced += 1;
            }

            for (const inst of instruments) {
                const exchange = toUpper(inst.exchange);
                if (exchange !== 'NFO') continue;

                const instrumentType = toUpper(inst.instrument_type || inst.instrumentType);
                if (!instrumentType.includes('FUT')) continue;
                if (!isCurrentMonthExpiry(inst.expiry, referenceDate, { exchange, segment: 'FNO' })) continue;

                const tradingsymbol = toUpper(inst.tradingsymbol);
                if (!tradingsymbol) continue;

                const symbol = `${exchange}:${tradingsymbol}`;
                const payload = {
                    symbol,
                    name: inst.name || tradingsymbol,
                    segment: 'FNO',
                    exchange,
                    provider: 'kite',
                    sourceSymbol: symbol,
                    lotSize: inst.lot_size || 1,
                    tickSize: inst.tick_size || 0.05,
                    instrumentToken: String(inst.instrument_token),
                    isActive: true,
                    isWatchlist: false,
                };
                const existingDoc = await findExistingFrontMonthFutureDoc(payload, referenceDate);

                const doc = await MasterSymbol.findOneAndUpdate(
                    existingDoc?._id ? { _id: existingDoc._id } : { symbol: payload.symbol },
                    { $set: payload },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );

                const nextSymbolId = buildMasterSymbolId(doc, { referenceDate });
                if (doc.symbolId !== nextSymbolId) {
                    doc.symbolId = nextSymbolId;
                    await doc.save();
                }

                nfoFuturesSynced += 1;
            }

            if (missing.size > 0) {
                logger.warn(`KITE_SYNC: Missing ${missing.size} symbols from allowlist`);
            }

            await this.loadIntoMemory();
            logger.info(`KITE_SYNC: Successfully synced ${synced} instruments into MongoDB`);
            logger.info(`KITE_SYNC: Synced ${nfoFuturesSynced} front-month NFO futures`);

            return { count: synced, missing: Array.from(missing), nfoFutures: nfoFuturesSynced };
        } catch (error) {
            logger.error(`KITE_SYNC: Sync failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Load instruments from MongoDB into memory maps
     */
    async loadIntoMemory() {
        try {
            logger.info('KITE_SYNC: Loading curated instruments into memory...');
            const docs = await MasterSymbol.find({
                provider: 'kite',
                instrumentToken: { $exists: true, $ne: null },
            }).lean();

            this.instrumentMap.clear();
            this.symbolMap.clear();

            for (const doc of docs) {
                const kiteSymbol = toKiteSymbol(doc);
                if (!kiteSymbol) continue;

                const [exchange, ...rest] = kiteSymbol.split(':');
                const tradingsymbol = rest.join(':');
                const inst = {
                    exchange,
                    tradingsymbol,
                    instrument_token: doc.instrumentToken,
                    name: doc.name,
                    segment: doc.segment,
                    lot_size: doc.lotSize,
                    tick_size: doc.tickSize,
                };

                const canonical = toUpper(doc.symbol);
                if (canonical) {
                    this.symbolMap.set(canonical, inst);
                }

                if (kiteSymbol && kiteSymbol !== canonical) {
                    this.symbolMap.set(kiteSymbol, inst);
                }

                if (doc.instrumentToken) {
                    this.instrumentMap.set(String(doc.instrumentToken), kiteSymbol);
                }
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
        return this.symbolMap.get(toUpper(symbol));
    }

    /**
     * Get full symbol by token
     */
    getSymbolByToken(token) {
        return this.instrumentMap.get(String(token).trim());
    }

    /**
     * Search instruments by query
     */
    search(query, limit = 50) {
        const results = [];
        const q = String(query || '').toUpperCase();

        const exactMatches = [];
        const startsWithMatches = [];
        const containsMatches = [];

        const seenTokens = new Set();

        for (const [symbol, inst] of this.symbolMap.entries()) {
            const tokenKey = String(inst.instrument_token || '');
            if (tokenKey && seenTokens.has(tokenKey)) continue;

            const s = symbol.toUpperCase();
            const n = (inst.name || '').toUpperCase();

            if (!s.includes(q) && !n.includes(q)) {
                continue;
            }

            if (tokenKey) seenTokens.add(tokenKey);

            const item = {
                symbol,
                name: inst.name,
                exchange: inst.exchange,
                instrumentToken: inst.instrument_token,
                segment: inst.segment,
                lotSize: inst.lot_size,
                tickSize: inst.tick_size,
            };

            if (s === q || n === q) {
                exactMatches.push(item);
            } else if (s.startsWith(q)) {
                startsWithMatches.push(item);
            } else {
                containsMatches.push(item);
            }
        }

        const sorted = [...exactMatches, ...startsWithMatches, ...containsMatches];
        return sorted.slice(0, limit);
    }
}

export const kiteInstrumentsService = new KiteInstrumentsService();
export default kiteInstrumentsService;

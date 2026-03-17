import { EventEmitter } from 'events';
import axios from 'axios';
import httpStatus from 'http-status';
import Setting from '../models/Setting.js';
import MasterSymbol from '../models/MasterSymbol.js';
import { kiteService } from './kite.service.js';
import { kiteInstrumentsService } from './kiteInstruments.service.js';
import mt5Service from './mt5.service.js';
import pipeline from '../utils/pipeline/DataPipeline.js';
import { redisClient } from './redis.service.js';
import logger from '../config/log.js';
import ApiError from '../utils/ApiError.js';
import { decrypt, encrypt } from '../utils/encryption.js';
import cacheManager from './cacheManager.js';
import { decorateSymbolSegment } from '../utils/marketSegmentResolver.js';
import { dedupeSymbols } from '../utils/marketSymbolDedupe.js';
import {
    hasExplicitContractMonth,
    isCurrentMonthContractDoc,
} from '../utils/currentMonthContracts.js';

const INDIAN_EXCHANGES = new Set(['NSE', 'BSE', 'MCX', 'NFO', 'CDS', 'BCD']);
const INDIA_TIMEZONE_OFFSET_SEC = 5.5 * 60 * 60;
const SENSITIVE_KEY_PATTERN = /(api_key|api_secret|access_token)/i;
const SYMBOLS_CACHE_VERSION_KEY = 'market_symbols_cache_version';
const SYMBOLS_CACHE_TTL = '5m';
const SYMBOL_SEARCH_CACHE_TTL = '5m';
const CONTRACT_MONTH_TEXT_REGEX = /JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/i;
const CURRENT_MONTH_CONTRACT_EXCHANGES = ['MCX', 'COMEX', 'NYMEX', 'NFO', 'CDS', 'BCD', 'NSEIX'];
const CURRENT_MONTH_CONTRACT_SEGMENTS = ['FNO', 'COMMODITY', 'COMEX', 'CURRENCY'];
const KITE_HISTORY_ALIASES = new Map([
    ['BANKNIFTY', 'NSE:NIFTY BANK-INDEX'],
    ['NSE:BANKNIFTY', 'NSE:NIFTY BANK-INDEX'],
    ['NSE:NIFTYBANK', 'NSE:NIFTY BANK-INDEX'],
    ['NSE:NIFTY BANK', 'NSE:NIFTY BANK-INDEX'],
    ['NIFTY', 'NSE:NIFTY 50-INDEX'],
    ['NIFTY50', 'NSE:NIFTY 50-INDEX'],
    ['NSE:NIFTY', 'NSE:NIFTY 50-INDEX'],
    ['NSE:NIFTY 50', 'NSE:NIFTY 50-INDEX'],
    ['FINNIFTY', 'NSE:NIFTY FIN SERVICE-INDEX'],
    ['NSE:FINNIFTY', 'NSE:NIFTY FIN SERVICE-INDEX'],
    ['NSE:NIFTY FIN SERVICE', 'NSE:NIFTY FIN SERVICE-INDEX'],
    ['INDIAVIX', 'NSE:INDIA VIX'],
    ['NSE:INDIAVIX', 'NSE:INDIA VIX'],
]);

const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const parseTs = (value, fallback = Math.floor(Date.now() / 1000)) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (value instanceof Date) return Math.floor(value.getTime() / 1000);

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric > 10000000000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
        return Math.floor(date.getTime() / 1000);
    }

    return fallback;
};

const resolutionToKiteInterval = (resolution) => {
    const normalized = String(resolution || '').trim().toUpperCase();

    if (normalized === '1') return 'minute';
    if (normalized === '3') return '3minute';
    if (normalized === '5') return '5minute';
    if (normalized === '10') return '10minute';
    if (normalized === '15') return '15minute';
    if (normalized === '30') return '30minute';
    if (normalized === '45') return '60minute';
    if (normalized === '60' || normalized === '1H') return '60minute';
    if (normalized === 'D' || normalized === '1D' || normalized === 'DAY') return 'day';
    if (normalized === 'W' || normalized === '1W' || normalized === 'WEEK') return 'day';
    if (normalized === 'M' || normalized === '1M' || normalized === 'MN' || normalized === 'MONTH') return 'day';

    return 'minute';
};

const isWeeklyResolution = (resolution) => {
    const normalized = String(resolution || '').trim().toUpperCase();
    return normalized === 'W' || normalized === '1W' || normalized === 'WEEK';
};

const isMonthlyResolution = (resolution) => {
    const normalized = String(resolution || '').trim().toUpperCase();
    return normalized === 'M' || normalized === '1M' || normalized === 'MN' || normalized === 'MONTH';
};

const isAggregatedResolution = (resolution) => isWeeklyResolution(resolution) || isMonthlyResolution(resolution);

const getAggregateBucketStart = (timeSec, resolution) => {
    const shiftedDate = new Date((timeSec + INDIA_TIMEZONE_OFFSET_SEC) * 1000);
    shiftedDate.setUTCHours(0, 0, 0, 0);

    if (isWeeklyResolution(resolution)) {
        const day = shiftedDate.getUTCDay();
        const diff = shiftedDate.getUTCDate() - day + (day === 0 ? -6 : 1);
        shiftedDate.setUTCDate(diff);
    } else if (isMonthlyResolution(resolution)) {
        shiftedDate.setUTCDate(1);
    }

    return Math.floor(shiftedDate.getTime() / 1000) - INDIA_TIMEZONE_OFFSET_SEC;
};

const aggregateCandlesForResolution = (candles = [], resolution, countOverride = null) => {
    const safeCandles = Array.isArray(candles)
        ? candles
            .filter((candle) => candle && candle.time && candle.close !== undefined)
            .sort((a, b) => a.time - b.time)
        : [];

    if (!isAggregatedResolution(resolution)) {
        if (countOverride !== null && countOverride !== undefined) {
            const boundedCount = Number.parseInt(countOverride, 10);
            if (Number.isFinite(boundedCount) && boundedCount > 0) {
                return safeCandles.slice(-boundedCount);
            }
        }
        return safeCandles;
    }

    const aggregated = [];
    let current = null;

    for (const candle of safeCandles) {
        const bucketStart = getAggregateBucketStart(candle.time, resolution);
        if (!current || current.time !== bucketStart) {
            current = {
                time: bucketStart,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: toNumber(candle.volume, 0),
            };
            aggregated.push(current);
            continue;
        }

        current.high = Math.max(current.high, candle.high);
        current.low = Math.min(current.low, candle.low);
        current.close = candle.close;
        current.volume = toNumber(current.volume, 0) + toNumber(candle.volume, 0);
    }

    if (countOverride !== null && countOverride !== undefined) {
        const boundedCount = Number.parseInt(countOverride, 10);
        if (Number.isFinite(boundedCount) && boundedCount > 0) {
            return aggregated.slice(-boundedCount);
        }
    }

    return aggregated;
};

class MarketDataService extends EventEmitter {
    constructor() {
        super();

        this.mode = 'idle';
        this.startTime = new Date();

        this.symbols = {};
        this.tokenMap = {};
        this.tokenSymbolsMap = new Map();
        this.symbolCaseMap = new Map();
        this.marketDataAliasMap = new Map();
        this._symbolsCacheVersion = 1;

        this.currentPrices = {};
        this.currentQuotes = {};
        this._lastPersistedAt = {};
        this._persistBlockedUntil = 0;

        this.config = {};
        this.adapter = null;

        this.kiteTickCount = 0;
        this.kiteLatency = 0;
        this._instrumentTokenResolutionPromises = new Map();

        this._kiteMcxFuturesIndex = null;
        this._kiteMcxFuturesIndexBuiltAtMs = 0;
        this._kiteMcxFuturesIndexPromise = null;

        this.marketDataTickCount = 0;
        this.marketDataLatency = 0;

        this.kiteAuthBrokenUntil = 0;
        this.statsInterval = null;

        this._lastKiteStatsLogAtMs = 0;
        this._lastMarketDataStatsLogAtMs = 0;
        this._pendingTickBatches = [];
        this._queuedTickCount = 0;
        this._isTickDraining = false;
        this._tickDrainScheduled = false;
        this._lastTickDropWarnAtMs = 0;
        const configuredTickBatchSize = Number.parseInt(
            process.env.MARKET_DATA_TICK_BATCH_SIZE || process.env.MARKETDATA_TICK_BATCH_SIZE || '300',
            10
        );
        this.tickProcessBatchSize = Number.isFinite(configuredTickBatchSize) && configuredTickBatchSize > 0
            ? configuredTickBatchSize
            : 300;
        const configuredMaxQueuedTicks = Number.parseInt(process.env.MARKET_DATA_MAX_QUEUED_TICKS || '50000', 10);
        this.maxQueuedTicks = Number.isFinite(configuredMaxQueuedTicks) && configuredMaxQueuedTicks > 0
            ? configuredMaxQueuedTicks
            : 50000;
    }

    async _getKiteMcxFuturesIndex() {
        const nowMs = Date.now();
        const ttlMs = 12 * 60 * 60 * 1000; // 12h

        if (
            this._kiteMcxFuturesIndex &&
            nowMs - this._kiteMcxFuturesIndexBuiltAtMs < ttlMs
        ) {
            return this._kiteMcxFuturesIndex;
        }

        if (this._kiteMcxFuturesIndexPromise) {
            return this._kiteMcxFuturesIndexPromise;
        }

        if (!this.adapter || typeof this.adapter.getInstruments !== 'function') {
            return this._kiteMcxFuturesIndex || new Map();
        }

        this._kiteMcxFuturesIndexPromise = (async () => {
            try {
                const instruments = await this.adapter.getInstruments();
                const index = new Map();

                for (const inst of Array.isArray(instruments) ? instruments : []) {
                    const exchange = String(inst?.exchange || '').trim().toUpperCase();
                    if (exchange !== 'MCX') continue;

                    const instrumentType = String(inst?.instrument_type || inst?.instrumentType || '').trim().toUpperCase();
                    const segment = String(inst?.segment || '').trim().toUpperCase();
                    const isFut = instrumentType.includes('FUT') || segment.includes('FUT');
                    if (!isFut) continue;

                    const nameKey = this._normalizeMarketSymbol(inst?.name || '');
                    const tradingSymbol = this._normalizeMarketSymbol(inst?.tradingsymbol || '');
                    const token = String(inst?.instrument_token ?? inst?.instrumentToken ?? '').trim();
                    if (!nameKey || !tradingSymbol || !token) continue;

                    const expiryRaw = inst?.expiry;
                    const expiryDate = expiryRaw instanceof Date ? expiryRaw : new Date(expiryRaw);
                    const expiry = Number.isNaN(expiryDate.getTime()) ? null : expiryDate;

                    if (!index.has(nameKey)) {
                        index.set(nameKey, []);
                    }

                    index.get(nameKey).push({
                        tradingsymbol: tradingSymbol,
                        instrument_token: token,
                        expiry,
                    });
                }

                for (const list of index.values()) {
                    list.sort((left, right) => {
                        const leftTime = left.expiry ? left.expiry.getTime() : Number.POSITIVE_INFINITY;
                        const rightTime = right.expiry ? right.expiry.getTime() : Number.POSITIVE_INFINITY;
                        return leftTime - rightTime;
                    });
                }

                this._kiteMcxFuturesIndex = index;
                this._kiteMcxFuturesIndexBuiltAtMs = Date.now();
                return index;
            } catch (error) {
                logger.warn(`MARKET_DATA: Failed loading MCX futures index from Kite: ${error.message}`);
                return this._kiteMcxFuturesIndex || new Map();
            } finally {
                this._kiteMcxFuturesIndexPromise = null;
            }
        })();

        return this._kiteMcxFuturesIndexPromise;
    }

    async _resolveKiteMcxContinuousFuture(symbolDoc, canonicalSymbol) {
        const exchange = String(symbolDoc?.exchange || canonicalSymbol?.split?.(':')?.[0] || '').trim().toUpperCase();
        if (exchange !== 'MCX') return null;

        // A symbol like "MCX:CRUDEOILM" is a continuous/root ticker, not a tradable contract in Kite.
        // Resolve to the nearest-expiry future contract to fetch quotes / subscribe.
        // Important: ignore `sourceSymbol` when deciding whether this is a contract doc, because `sourceSymbol`
        // may already point to a specific expiry contract even when the canonical symbol is a continuous/root.
        if (hasExplicitContractMonth({ symbol: canonicalSymbol, name: symbolDoc?.name })) {
            return null;
        }

        const normalized = this._normalizeMarketSymbol(canonicalSymbol);
        const base = normalized.includes(':') ? normalized.split(':').slice(1).join(':') : normalized;
        const baseKey = this._normalizeMarketSymbol(base);
        const nameKey = this._normalizeMarketSymbol(symbolDoc?.name || '');

        const index = await this._getKiteMcxFuturesIndex();
        const candidates =
            index.get(baseKey) ||
            (nameKey ? index.get(nameKey) : null) ||
            [];
        if (candidates.length === 0) return null;

        const now = new Date();
        const picked = candidates.find((item) => item.expiry && item.expiry >= now) || candidates[0];
        if (!picked?.tradingsymbol || !picked?.instrument_token) return null;

        return {
            kiteSymbol: `MCX:${picked.tradingsymbol}`,
            instrumentToken: String(picked.instrument_token).trim(),
        };
    }

    async init() {
        logger.info('MARKET_DATA: Initializing service...');

        try {
            await this.initializeKiteInstruments();
            const cleanupResult = await this.cleanupStaleDerivativeContracts();
            if (cleanupResult.deletedCount > 0) {
                await this.loadMasterSymbols({ forceReload: true });
                await this.refreshSymbolsCache({ bumpVersion: true });
            } else {
                await this.loadMasterSymbols();
            }
            await this.loadSettings();
            this.startStatsBroadcast();
        } catch (error) {
            logger.error('MARKET_DATA: Failed to initialize', error);
        }
    }

    async initializeKiteInstruments() {
        try {
            await kiteInstrumentsService.loadIntoMemory();
        } catch (error) {
            logger.error(`MARKET_DATA: Failed loading Kite instruments: ${error.message}`);
        }
    }

    startStatsBroadcast() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }

        let intervalMs = Number.parseInt(process.env.MARKETDATA_STATS_INTERVAL_MS || '5000', 10);
        if (!Number.isFinite(intervalMs) || intervalMs < 500) {
            intervalMs = 5000;
        }

        this.statsInterval = setInterval(async () => {
            const includePrices = String(process.env.MARKETDATA_STATS_INCLUDE_PRICES || '').toLowerCase() === 'true';
            const stats = this.getStats({ includePrices });
            this.emit('stats_update', stats);

            if (redisClient?.status === 'ready') {
                try {
                    await redisClient.publish('market_stats', JSON.stringify(stats));
                } catch (error) {
                    logger.debug(`MARKET_DATA: Failed publishing stats to Redis: ${error.message}`);
                }
            }
        }, intervalMs);
    }

    _rememberSymbolCase(symbol) {
        if (!symbol) return;
        this.symbolCaseMap.set(symbol.toLowerCase(), symbol);
    }

    _normalizeMarketSymbol(symbol) {
        return String(symbol || '').trim().toUpperCase();
    }

    _resolveHistoryAlias(symbol) {
        const normalized = this._normalizeMarketSymbol(symbol);
        return KITE_HISTORY_ALIASES.get(normalized) || normalized;
    }

    _isIndianSymbol(symbol, symbolDoc = null) {
        const docExchange = String(symbolDoc?.exchange || '').toUpperCase();
        if (docExchange && INDIAN_EXCHANGES.has(docExchange)) return true;
        const normalized = this._normalizeMarketSymbol(symbol);
        if (normalized.includes(':')) {
            const exchange = normalized.split(':')[0];
            return INDIAN_EXCHANGES.has(exchange);
        }
        return false;
    }

    _getUsdUsdtAlias(symbol) {
        const normalized = this._normalizeMarketSymbol(symbol);
        if (!normalized) return null;

        const withSuffix = normalized.match(/^([A-Z0-9]+?)(USDT|USD)([.:/_-][A-Z0-9._:-]*)?$/);
        if (withSuffix) {
            const [, base, quote, suffix = ''] = withSuffix;
            return `${base}${quote === 'USDT' ? 'USD' : 'USDT'}${suffix}`;
        }

        if (normalized.endsWith('USDT')) {
            return normalized.slice(0, -1); // BTCUSDT -> BTCUSD
        }

        if (normalized.endsWith('USD')) {
            return `${normalized}T`; // BTCUSD -> BTCUSDT
        }

        return null;
    }

    _registerMarketDataAliases(canonicalSymbol, wireSymbols = []) {
        const canonical = this._getCanonicalSymbol(canonicalSymbol) || this._normalizeMarketSymbol(canonicalSymbol);
        if (!canonical) return;

        const list = Array.isArray(wireSymbols) ? wireSymbols : [wireSymbols];
        for (const wire of list) {
            const normalizedWire = this._normalizeMarketSymbol(wire);
            if (!normalizedWire) continue;

            const key = normalizedWire.toLowerCase();
            if (!this.marketDataAliasMap.has(key)) {
                this.marketDataAliasMap.set(key, new Set());
            }

            this.marketDataAliasMap.get(key).add(canonical);
            this._rememberSymbolCase(normalizedWire);
        }
    }

    _rememberTokenAlias(token, symbol) {
        const normalizedToken = String(token || '').trim();
        const canonical = this._getCanonicalSymbol(symbol) || this._normalizeMarketSymbol(symbol);
        if (!normalizedToken || !canonical) return;

        this.tokenMap[normalizedToken] = canonical;
        if (!this.tokenSymbolsMap.has(normalizedToken)) {
            this.tokenSymbolsMap.set(normalizedToken, new Set());
        }
        this.tokenSymbolsMap.get(normalizedToken).add(canonical);
    }

    _resolveTokenTargets(token) {
        const normalizedToken = String(token || '').trim();
        if (!normalizedToken) return [];

        const targets = new Set();
        const primary = this.tokenMap[normalizedToken];
        if (primary) {
            const canonicalPrimary = this._getCanonicalSymbol(primary) || this._normalizeMarketSymbol(primary);
            if (canonicalPrimary) targets.add(canonicalPrimary);
        }

        const mapped = this.tokenSymbolsMap.get(normalizedToken);
        if (mapped && mapped.size > 0) {
            for (const symbol of mapped) {
                const canonical = this._getCanonicalSymbol(symbol) || this._normalizeMarketSymbol(symbol);
                if (canonical) targets.add(canonical);
            }
        }

        return Array.from(targets);
    }

    _resolveMarketDataWireSymbols(symbolDoc) {
        if (!symbolDoc?.symbol) return [];

        const wireSymbols = new Set();
        const canonical = this._normalizeMarketSymbol(symbolDoc.symbol);
        const sourceSymbol = this._normalizeMarketSymbol(symbolDoc.sourceSymbol);

        if (canonical) wireSymbols.add(canonical);
        if (sourceSymbol) wireSymbols.add(sourceSymbol);

        const segment = this._normalizeMarketSymbol(symbolDoc.segment);
        const exchange = this._normalizeMarketSymbol(symbolDoc.exchange);

        if (segment === 'CRYPTO' || exchange === 'CRYPTO') {
            const alias = this._getUsdUsdtAlias(canonical);
            if (alias) wireSymbols.add(alias);

            const sourceAlias = this._getUsdUsdtAlias(sourceSymbol);
            if (sourceAlias) wireSymbols.add(sourceAlias);
        }

        return Array.from(wireSymbols).filter(Boolean);
    }

    _resolveAliasTargets(symbol) {
        const normalized = this._normalizeMarketSymbol(symbol);
        if (!normalized) return [];

        const targets = new Set();
        const canonical = this._getCanonicalSymbol(normalized) || normalized;
        targets.add(canonical);

        const mapped = this.marketDataAliasMap.get(normalized.toLowerCase());
        if (mapped && mapped.size > 0) {
            for (const candidate of mapped) {
                const resolved = this._getCanonicalSymbol(candidate) || this._normalizeMarketSymbol(candidate);
                if (resolved) targets.add(resolved);
            }
        }

        const usdUsdtAlias = this._getUsdUsdtAlias(normalized);
        if (usdUsdtAlias) {
            const resolvedAlias = this._getCanonicalSymbol(usdUsdtAlias);
            if (resolvedAlias && this.symbols[resolvedAlias]) {
                targets.add(resolvedAlias);
            }
        }

        return Array.from(targets);
    }

    _collectPriceCandidates(symbol, symbolDoc = null) {
        const candidates = [];
        const seen = new Set();

        const addCandidate = (value) => {
            const normalized = this._normalizeMarketSymbol(value);
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            candidates.push(normalized);
        };

        const canonical = this._getCanonicalSymbol(symbol) || this._normalizeMarketSymbol(symbol);
        if (!canonical) return candidates;

        addCandidate(canonical);
        const historyAlias = this._resolveHistoryAlias(canonical);
        if (historyAlias && historyAlias !== canonical) {
            addCandidate(historyAlias);
        }

        const doc = symbolDoc || this.symbols[canonical] || null;
        if (doc?.symbol) addCandidate(doc.symbol);
        if (doc?.sourceSymbol) addCandidate(doc.sourceSymbol);

        if (doc?.symbol) {
            const wireSymbols = this._resolveMarketDataWireSymbols(doc);
            wireSymbols.forEach(addCandidate);
        }

        this._resolveAliasTargets(canonical).forEach(addCandidate);

        for (const value of [...candidates]) {
            const alias = this._getUsdUsdtAlias(value);
            if (!alias) continue;
            addCandidate(alias);
            this._resolveAliasTargets(alias).forEach(addCandidate);
        }

        return candidates;
    }

    getBestLivePrice(symbol, symbolDoc = null, fallback = 0) {
        const candidates = this._collectPriceCandidates(symbol, symbolDoc);

        for (const candidate of candidates) {
            const direct = toNumber(this.currentPrices[candidate], NaN);
            if (Number.isFinite(direct) && direct > 0) {
                return direct;
            }
        }

        for (const candidate of candidates) {
            const quote = this.currentQuotes[candidate];
            if (!quote) continue;

            const close = toNumber(quote?.ohlc?.close, NaN);
            if (Number.isFinite(close) && close > 0) return close;

            const bid = toNumber(quote?.bid, NaN);
            if (Number.isFinite(bid) && bid > 0) return bid;

            const ask = toNumber(quote?.ask, NaN);
            if (Number.isFinite(ask) && ask > 0) return ask;
        }

        return toNumber(fallback, 0);
    }

    getBestQuote(symbol, symbolDoc = null) {
        const candidates = this._collectPriceCandidates(symbol, symbolDoc);
        for (const candidate of candidates) {
            const quote = this.currentQuotes[candidate];
            if (quote && typeof quote === 'object') {
                return quote;
            }
        }
        return null;
    }

    _getCanonicalSymbol(symbol) {
        if (!symbol) return null;
        const raw = String(symbol).trim();
        if (!raw) return null;

        const direct = this.symbols[raw] ? raw : null;
        if (direct) return direct;

        return this.symbolCaseMap.get(raw.toLowerCase()) || raw;
    }

    _toKiteQuoteSymbol(rawSymbol, symbolDoc = null) {
        const normalizedRaw = this._normalizeMarketSymbol(rawSymbol);
        const historyAlias = this._resolveHistoryAlias(normalizedRaw);
        const canonical = this._getCanonicalSymbol(historyAlias) || historyAlias || normalizedRaw;
        if (!canonical) return null;

        if (symbolDoc?.sourceSymbol) {
            return String(symbolDoc.sourceSymbol).trim().toUpperCase();
        }

        const token = symbolDoc?.instrumentToken;
        if (token) {
            const byToken = kiteInstrumentsService.getSymbolByToken(String(token));
            if (byToken) return byToken;
        }

        const fromMap = kiteInstrumentsService.getInstrumentBySymbol(canonical);
        if (fromMap) {
            return `${fromMap.exchange}:${fromMap.tradingsymbol}`;
        }

        const parts = canonical.split(':');
        if (parts.length < 2) return canonical;

        const exchange = parts[0].trim().toUpperCase();
        let tradingSymbol = parts.slice(1).join(':').trim().toUpperCase();
        if (!exchange || !tradingSymbol) return canonical;

        if (tradingSymbol.endsWith('-EQ')) {
            tradingSymbol = tradingSymbol.slice(0, -3);
        } else if (tradingSymbol.endsWith('.EQ')) {
            tradingSymbol = tradingSymbol.slice(0, -3);
        } else if (tradingSymbol.endsWith('-INDEX')) {
            tradingSymbol = tradingSymbol.slice(0, -6);
        }

        return tradingSymbol ? `${exchange}:${tradingSymbol}` : canonical;
    }

    _isMarketDataSymbol(symbolDoc) {
        if (!symbolDoc) return false;

        const provider = String(symbolDoc.provider || '').toLowerCase();
        if (provider === 'market_data' || provider === 'mt5') return true;
        if (provider === 'kite') return false;

        const exchange = String(symbolDoc.exchange || '').toUpperCase();
        if (exchange) return !INDIAN_EXCHANGES.has(exchange);

        return !symbolDoc.instrumentToken;
    }

    async _ensureKiteInstrumentToken(symbolDoc) {
        const canonical = this._getCanonicalSymbol(symbolDoc?.symbol);
        if (!canonical) return null;

        const inMemoryDoc = this.symbols[canonical] || null;
        const resolvedDoc = inMemoryDoc || symbolDoc || null;
        if (!resolvedDoc) return null;
        if (this._isMarketDataSymbol(resolvedDoc)) return null;
        if (!this._isIndianSymbol(canonical, resolvedDoc)) return null;
        if (!this.adapter || !this.config?.kite_access_token || !this.adapter.getQuote) return null;

        const exchange = String(resolvedDoc?.exchange || canonical.split(':')[0] || '').trim().toUpperCase();
        const isMcxContinuousRoot = exchange === 'MCX' && !hasExplicitContractMonth({ symbol: canonical, name: resolvedDoc?.name });

        const existingToken = String(symbolDoc?.instrumentToken || inMemoryDoc?.instrumentToken || '').trim();
        if (existingToken) {
            // MCX continuous/root symbols should always track the near-expiry contract. Tokens change each expiry,
            // so we validate against the current near-expiry token before reusing a persisted token.
            if (!isMcxContinuousRoot) {
                this._rememberTokenAlias(existingToken, canonical);
                return existingToken;
            }

            try {
                const desired = await this._resolveKiteMcxContinuousFuture(resolvedDoc, canonical);
                const desiredToken = String(desired?.instrumentToken || '').trim();
                if (desiredToken && desiredToken === existingToken) {
                    this._rememberTokenAlias(existingToken, canonical);
                    return existingToken;
                }
                // Token looks stale (or couldn't validate), fall through to resolve via quote below.
            } catch (error) {
                // If validation fails, reuse the existing token rather than breaking subscriptions.
                this._rememberTokenAlias(existingToken, canonical);
                return existingToken;
            }
        }

        const pending = this._instrumentTokenResolutionPromises.get(canonical);
        if (pending) {
            return pending;
        }

        const task = (async () => {
            const primaryKiteSymbol = this._toKiteQuoteSymbol(canonical, resolvedDoc);
            if (!primaryKiteSymbol) return null;

            try {
                const startedAt = Date.now();
                let kiteSymbol = primaryKiteSymbol;
                let mcxFallback = null;

                if (isMcxContinuousRoot) {
                    mcxFallback = await this._resolveKiteMcxContinuousFuture(resolvedDoc, canonical);
                    if (mcxFallback?.kiteSymbol) {
                        kiteSymbol = mcxFallback.kiteSymbol;
                    }
                }
                let quoteData = await this.adapter.getQuote([kiteSymbol]);
                this.kiteLatency = Date.now() - startedAt;

                const item =
                    quoteData?.[kiteSymbol] ||
                    quoteData?.[canonical] ||
                    Object.values(quoteData || {})[0] ||
                    null;
                let token = String(item?.instrument_token || '').trim();

                if (!token) {
                    const fallback = mcxFallback || await this._resolveKiteMcxContinuousFuture(resolvedDoc, canonical);
                    if (fallback?.kiteSymbol) {
                        kiteSymbol = fallback.kiteSymbol;
                        const retryStartedAt = Date.now();
                        quoteData = await this.adapter.getQuote([kiteSymbol]);
                        this.kiteLatency = Date.now() - retryStartedAt;

                        const retryItem =
                            quoteData?.[kiteSymbol] ||
                            Object.values(quoteData || {})[0] ||
                            null;
                        token = String(retryItem?.instrument_token || fallback.instrumentToken || '').trim();

                        if (retryItem) {
                            // Swap in retry result for downstream processing.
                            quoteData = { [kiteSymbol]: retryItem };
                        }
                    }
                }
                if (!token) {
                    logger.warn(`MARKET_DATA: Kite token resolution returned no instrument token for ${canonical}`);
                    return null;
                }

                const nextDoc = {
                    ...(typeof resolvedDoc?.toObject === 'function' ? resolvedDoc.toObject() : resolvedDoc),
                    symbol: canonical,
                    instrumentToken: token,
                    // For MCX continuous/root tickers we always map to the current near-expiry contract in memory.
                    sourceSymbol: isMcxContinuousRoot ? kiteSymbol : (resolvedDoc?.sourceSymbol || kiteSymbol),
                };

                this.symbols[canonical] = nextDoc;
                this._rememberSymbolCase(canonical);
                this._rememberTokenAlias(token, canonical);

                if (!isMcxContinuousRoot) {
                    await MasterSymbol.findOneAndUpdate(
                        { symbol: canonical },
                        {
                            $set: {
                                instrumentToken: token,
                                ...(resolvedDoc?.sourceSymbol ? {} : { sourceSymbol: kiteSymbol }),
                            },
                        },
                        { new: false }
                    ).catch((error) => {
                        logger.warn(
                            `MARKET_DATA: Failed persisting resolved Kite token for ${canonical}: ${error.message}`
                        );
                    });
                }

                if (item && Number.isFinite(toNumber(item.last_price, NaN))) {
                    this.processLiveTicks(
                        [
                            {
                                instrument_token: token,
                                last_price: item.last_price,
                                ohlc: item.ohlc,
                                bid: item.depth?.buy?.[0]?.price,
                                ask: item.depth?.sell?.[0]?.price,
                                volume: item.volume,
                                timestamp: new Date(),
                            },
                        ],
                        'kite'
                    );
                }

                logger.info(`MARKET_DATA: Resolved Kite instrument token for ${canonical}`);
                return token;
            } catch (error) {
                logger.warn(`MARKET_DATA: Kite token resolution failed for ${canonical}: ${error.message}`);
                return null;
            }
        })();

        this._instrumentTokenResolutionPromises.set(canonical, task);

        try {
            return await task;
        } finally {
            this._instrumentTokenResolutionPromises.delete(canonical);
        }
    }

    async _getSymbolsCacheVersion() {
        if (redisClient?.status === 'ready') {
            try {
                const value = await redisClient.get(SYMBOLS_CACHE_VERSION_KEY);
                const parsed = Number.parseInt(value, 10);
                if (Number.isFinite(parsed) && parsed > 0) {
                    this._symbolsCacheVersion = parsed;
                    return this._symbolsCacheVersion;
                }

                await redisClient.set(SYMBOLS_CACHE_VERSION_KEY, String(this._symbolsCacheVersion));
            } catch (error) {
                logger.debug(`MARKET_DATA: Failed reading symbols cache version: ${error.message}`);
            }
        }

        return this._symbolsCacheVersion;
    }

    async _bumpSymbolsCacheVersion() {
        if (redisClient?.status === 'ready') {
            try {
                const next = await redisClient.incr(SYMBOLS_CACHE_VERSION_KEY);
                const parsed = Number.parseInt(next, 10);
                if (Number.isFinite(parsed) && parsed > 0) {
                    this._symbolsCacheVersion = parsed;
                    return this._symbolsCacheVersion;
                }
            } catch (error) {
                logger.debug(`MARKET_DATA: Failed bumping symbols cache version: ${error.message}`);
            }
        }

        this._symbolsCacheVersion += 1;
        return this._symbolsCacheVersion;
    }

    _buildSymbolsSnapshot() {
        return Object.values(this.symbols)
            .filter(Boolean)
            .map((doc) => (typeof doc?.toObject === 'function' ? doc.toObject() : { ...doc }));
    }

    async _persistSymbolsCache() {
        const version = await this._getSymbolsCacheVersion();
        const cacheKey = `master_symbols_v${version}`;
        const snapshot = this._buildSymbolsSnapshot();
        await cacheManager.set(cacheKey, snapshot, SYMBOLS_CACHE_TTL);
    }

    async refreshSymbolsCache({ bumpVersion = true } = {}) {
        if (bumpVersion) {
            await this._bumpSymbolsCacheVersion();
        }
        await this._persistSymbolsCache();
    }

    async cleanupStaleDerivativeContracts(referenceDate = new Date()) {
        try {
            const candidates = await MasterSymbol.find({
                $or: [
                    { exchange: { $in: CURRENT_MONTH_CONTRACT_EXCHANGES } },
                    { segment: { $in: CURRENT_MONTH_CONTRACT_SEGMENTS } },
                    { symbol: CONTRACT_MONTH_TEXT_REGEX },
                    { sourceSymbol: CONTRACT_MONTH_TEXT_REGEX },
                    { name: CONTRACT_MONTH_TEXT_REGEX },
                ],
            })
                .select('_id symbol name segment exchange sourceSymbol')
                .lean();

            const staleDocs = candidates.filter((doc) => {
                // Only treat docs as explicit contracts if their *canonical* symbol/name encodes a month,
                // not if their `sourceSymbol` happens to point at a specific expiry (e.g. MCX continuous roots).
                const contractLike = { symbol: doc.symbol, name: doc.name };
                return (
                    hasExplicitContractMonth(contractLike, referenceDate) &&
                    !isCurrentMonthContractDoc(contractLike, referenceDate)
                );
            });

            if (staleDocs.length === 0) {
                return { deletedCount: 0, deletedSymbols: [] };
            }

            await MasterSymbol.deleteMany({
                _id: { $in: staleDocs.map((doc) => doc._id) },
            });

            logger.warn(
                `MARKET_DATA: Removed ${staleDocs.length} stale derivative contracts outside ${referenceDate.getUTCFullYear()}-${String(referenceDate.getUTCMonth() + 1).padStart(2, '0')}`
            );

            return {
                deletedCount: staleDocs.length,
                deletedSymbols: staleDocs.map((doc) => doc.symbol).slice(0, 50),
            };
        } catch (error) {
            logger.error(`MARKET_DATA: Failed cleaning stale derivative contracts: ${error.message}`);
            return { deletedCount: 0, deletedSymbols: [], error: error.message };
        }
    }

    async loadMasterSymbols({ forceReload = false } = {}) {
        try {
            const version = await this._getSymbolsCacheVersion();
            const cacheKey = `master_symbols_v${version}`;

            let docs = null;
            if (!forceReload) {
                docs = await cacheManager.get(cacheKey);
            }
            if (!Array.isArray(docs)) {
                docs = await MasterSymbol.find({}).lean();
                await cacheManager.set(cacheKey, docs, SYMBOLS_CACHE_TTL);
            }

            this.symbols = {};
            this.tokenMap = {};
            this.tokenSymbolsMap.clear();
            this.symbolCaseMap.clear();
            this.marketDataAliasMap.clear();

            for (const doc of docs) {
                this.symbols[doc.symbol] = doc;
                this._rememberSymbolCase(doc.symbol);

                if (doc.instrumentToken) {
                    this._rememberTokenAlias(doc.instrumentToken, doc.symbol);
                }

                if (doc.sourceSymbol) {
                    this._registerMarketDataAliases(doc.symbol, [doc.sourceSymbol]);
                }
            }

            for (const doc of docs) {
                if (!this._isMarketDataSymbol(doc)) continue;
                const wireSymbols = this._resolveMarketDataWireSymbols(doc);
                this._registerMarketDataAliases(doc.symbol, wireSymbols);
            }

            logger.info(`MARKET_DATA: Loaded ${docs.length} symbols in memory`);
        } catch (error) {
            logger.error(`MARKET_DATA: Failed loading symbols: ${error.message}`);
        }
    }

    async addSymbol(symbolDoc) {
        if (!symbolDoc?.symbol) return;

        this.symbols[symbolDoc.symbol] = symbolDoc;
        this._rememberSymbolCase(symbolDoc.symbol);

        if (symbolDoc.instrumentToken) {
            this._rememberTokenAlias(symbolDoc.instrumentToken, symbolDoc.symbol);
        }

        if (symbolDoc.sourceSymbol) {
            this._registerMarketDataAliases(symbolDoc.symbol, [symbolDoc.sourceSymbol]);
        }
        if (this._isMarketDataSymbol(symbolDoc)) {
            const wireSymbols = this._resolveMarketDataWireSymbols(symbolDoc);
            this._registerMarketDataAliases(symbolDoc.symbol, wireSymbols);
        }

        await this.ensureSymbolSubscription(symbolDoc.symbol, symbolDoc);
    }

    async ensureSymbolSubscription(symbol, preloadedDoc = null) {
        const canonical = this._getCanonicalSymbol(symbol);
        if (!canonical) return null;

        let symbolDoc = preloadedDoc || this.symbols[canonical] || null;

        if (!symbolDoc) {
            try {
                symbolDoc = await MasterSymbol.findOne({ symbol: new RegExp(`^${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
            } catch (error) {
                logger.error(`MARKET_DATA: Symbol lookup failed for ${canonical}: ${error.message}`);
            }

            if (symbolDoc?.symbol) {
                this.symbols[symbolDoc.symbol] = symbolDoc;
                this._rememberSymbolCase(symbolDoc.symbol);
                if (symbolDoc.instrumentToken) {
                    this._rememberTokenAlias(symbolDoc.instrumentToken, symbolDoc.symbol);
                }
            }
        }

        if (!symbolDoc) return canonical;

        const exchange = String(symbolDoc?.exchange || canonical.split(':')[0] || '').trim().toUpperCase();
        const isMcxContinuousRoot =
            exchange === 'MCX' &&
            !hasExplicitContractMonth({ symbol: canonical, name: symbolDoc?.name });

        if (!symbolDoc.instrumentToken || isMcxContinuousRoot) {
            const resolvedToken = await this._ensureKiteInstrumentToken(symbolDoc);
            if (resolvedToken && resolvedToken !== symbolDoc.instrumentToken) {
                symbolDoc = this.symbols[symbolDoc.symbol] || { ...symbolDoc, instrumentToken: resolvedToken };
            }
        }

        const canUseMarketData = this._isMarketDataSymbol(symbolDoc) || !symbolDoc.instrumentToken;
        if (canUseMarketData) {
            const wireSymbols = this._resolveMarketDataWireSymbols(symbolDoc);
            const symbolsToSubscribe = wireSymbols.length > 0 ? wireSymbols : [symbolDoc.symbol];
            this._registerMarketDataAliases(symbolDoc.symbol, symbolsToSubscribe);
            mt5Service.subscribe(symbolsToSubscribe);
            return symbolDoc.symbol;
        }

        if (symbolDoc.instrumentToken) {
            if (this.adapter?.isTickerConnected) {
                this.adapter.subscribe([symbolDoc.instrumentToken]);
                await this.fetchInitialQuote([symbolDoc.instrumentToken]);
            }
            return symbolDoc.symbol;
        }

        return symbolDoc.symbol;
    }

    unsubscribeSymbol(symbol) {
        const canonical = this._getCanonicalSymbol(symbol);
        if (!canonical) return;

        const symbolDoc = this.symbols[canonical];
        if (!symbolDoc) return;

        if (symbolDoc.instrumentToken && this.adapter?.isTickerConnected) {
            this.adapter.unsubscribe([symbolDoc.instrumentToken]);
        }

        const canUseMarketData = this._isMarketDataSymbol(symbolDoc) || !symbolDoc.instrumentToken;
        if (canUseMarketData) {
            const wireSymbols = this._resolveMarketDataWireSymbols(symbolDoc);
            const symbolsToUnsubscribe = wireSymbols.length > 0 ? wireSymbols : [symbolDoc.symbol];
            mt5Service.unsubscribe(symbolsToUnsubscribe);
        }
    }

    subscribeToSymbols() {
        const allSymbols = Object.keys(this.symbols);
        if (allSymbols.length === 0) {
            logger.warn('MARKET_DATA: No symbols available to subscribe');
            return;
        }

        const kiteTokens = allSymbols
            .map((symbol) => this.symbols[symbol]?.instrumentToken)
            .filter(Boolean)
            .map((token) => String(token));

        if (kiteTokens.length > 0 && this.adapter?.isTickerConnected) {
            const uniqueKiteTokens = [...new Set(kiteTokens)];
            this.adapter.subscribe(uniqueKiteTokens);
            this.fetchInitialQuote(uniqueKiteTokens);
        }

        const bootSymbols = String(process.env.MARKET_DATA_BOOT_SYMBOLS || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);

        if (bootSymbols.length > 0) {
            mt5Service.subscribe(bootSymbols);
        }
    }

    async fetchInitialQuote(tokens) {
        if (!Array.isArray(tokens) || tokens.length === 0) return;
        if (!this.adapter || !this.config?.kite_access_token || !this.adapter.getQuote) return;

        try {
            const symbolsToFetch = [];

            for (const token of tokens) {
                const key = String(token);
                const kiteSymbol = kiteInstrumentsService.getSymbolByToken(key);
                if (kiteSymbol) {
                    symbolsToFetch.push(kiteSymbol);
                    continue;
                }

                const mappedSymbol = this.tokenMap[key];
                if (mappedSymbol) {
                    const symbolDoc = this.symbols[mappedSymbol] || null;
                    const normalized = this._toKiteQuoteSymbol(mappedSymbol, symbolDoc);
                    symbolsToFetch.push(normalized || mappedSymbol);
                }
            }

            if (symbolsToFetch.length === 0) return;

            const startedAt = Date.now();
            const quoteData = await this.adapter.getQuote(symbolsToFetch);
            this.kiteLatency = Date.now() - startedAt;

            const pseudoTicks = [];
            for (const kiteSymbol of Object.keys(quoteData || {})) {
                const item = quoteData[kiteSymbol];
                pseudoTicks.push({
                    instrument_token: item.instrument_token,
                    last_price: item.last_price,
                    ohlc: item.ohlc,
                    bid: item.depth?.buy?.[0]?.price,
                    ask: item.depth?.sell?.[0]?.price,
                    volume: item.volume,
                    timestamp: new Date(),
                });
            }

            if (pseudoTicks.length > 0) {
                this.processLiveTicks(pseudoTicks, 'kite');
            }
        } catch (error) {
            logger.error(`MARKET_DATA: Initial Kite quote fetch failed: ${error.message}`);
        }
    }

    async fetchQuoteBySymbols(symbols) {
        if (!Array.isArray(symbols) || symbols.length === 0) return;

        const kiteSymbols = [];
        const marketDataSymbols = new Set();
        const internalByKite = new Map();

        for (const rawSymbol of symbols) {
            const canonical = this._getCanonicalSymbol(rawSymbol);
            if (!canonical) continue;

            const symbolDoc = this.symbols[canonical] || null;

            const canUseMarketData = symbolDoc && this._isMarketDataSymbol(symbolDoc);
            if (canUseMarketData) {
                const wireSymbols = this._resolveMarketDataWireSymbols(symbolDoc);
                const symbolsToSubscribe = wireSymbols.length > 0 ? wireSymbols : [symbolDoc.symbol];
                this._registerMarketDataAliases(symbolDoc.symbol, symbolsToSubscribe);
                symbolsToSubscribe.forEach((value) => marketDataSymbols.add(value));
            } else {
                const kiteSymbol = this._toKiteQuoteSymbol(canonical, symbolDoc) || canonical;
                if (kiteSymbol) {
                    kiteSymbols.push(kiteSymbol);
                    internalByKite.set(kiteSymbol, symbolDoc?.symbol || canonical);
                } else {
                    marketDataSymbols.add(symbolDoc?.symbol || canonical);
                }
            }
        }

        if (marketDataSymbols.size > 0) {
            mt5Service.subscribe(Array.from(marketDataSymbols));
        }

        if (kiteSymbols.length === 0) return;
        if (!this.adapter || !this.config?.kite_access_token || !this.adapter.getQuote) return;

        try {
            const startedAt = Date.now();
            const quoteData = await this.adapter.getQuote([...new Set(kiteSymbols)]);
            this.kiteLatency = Date.now() - startedAt;

            for (const kiteSymbol of Object.keys(quoteData || {})) {
                const item = quoteData[kiteSymbol] || {};
                const fallbackInternal = this.tokenMap[String(item.instrument_token || '')] || null;
                const internalSymbol = internalByKite.get(kiteSymbol) || fallbackInternal || kiteSymbol;
                const price = toNumber(item.last_price, 0);

                this.currentPrices[internalSymbol] = price;
                this.currentQuotes[internalSymbol] = {
                    last_price: price,
                    ohlc: item.ohlc || this.currentQuotes[internalSymbol]?.ohlc || {
                        open: price,
                        high: price,
                        low: price,
                        close: price,
                    },
                    bid: item.depth?.buy?.[0]?.price || this.currentQuotes[internalSymbol]?.bid || 0,
                    ask: item.depth?.sell?.[0]?.price || this.currentQuotes[internalSymbol]?.ask || 0,
                    volume: toNumber(item.volume, this.currentQuotes[internalSymbol]?.volume || 0),
                };

                this._persistSymbolPrice(internalSymbol);
            }
        } catch (error) {
            logger.error(`MARKET_DATA: Quote fetch failed: ${error.message}`);
        }
    }

    processLiveTicks(ticks, provider = 'market_data') {
        if (!Array.isArray(ticks) || ticks.length === 0) return;

        const nowMs = Date.now();
        const source = String(provider || '').toLowerCase();

        if (source === 'kite') {
            this.kiteTickCount += ticks.length;
            if (nowMs - this._lastKiteStatsLogAtMs >= 10000) {
                logger.debug(`[KITE_STATS] ticks=${this.kiteTickCount}`);
                this._lastKiteStatsLogAtMs = nowMs;
            }
        } else {
            this.marketDataTickCount += ticks.length;
            if (nowMs - this._lastMarketDataStatsLogAtMs >= 10000) {
                logger.debug(`[MARKET_DATA_STATS] ticks=${this.marketDataTickCount}`);
                this._lastMarketDataStatsLogAtMs = nowMs;
            }
        }

        this._pendingTickBatches.push({
            source,
            ticks,
            index: 0,
        });
        this._queuedTickCount += ticks.length;

        let droppedTicks = 0;
        while (this._queuedTickCount > this.maxQueuedTicks && this._pendingTickBatches.length > 0) {
            const oldestBatch = this._pendingTickBatches[0];
            const remainingInBatch = Math.max(0, oldestBatch.ticks.length - oldestBatch.index);

            if (remainingInBatch === 0) {
                this._pendingTickBatches.shift();
                continue;
            }

            const overflow = this._queuedTickCount - this.maxQueuedTicks;
            if (overflow >= remainingInBatch) {
                this._pendingTickBatches.shift();
                this._queuedTickCount -= remainingInBatch;
                droppedTicks += remainingInBatch;
                continue;
            }

            oldestBatch.index += overflow;
            this._queuedTickCount -= overflow;
            droppedTicks += overflow;
            break;
        }

        if (droppedTicks > 0) {
            const now = Date.now();
            if (now - this._lastTickDropWarnAtMs >= 5000) {
                logger.warn(`MARKET_DATA: Dropped ${droppedTicks} queued ticks to protect event loop (max=${this.maxQueuedTicks})`);
                this._lastTickDropWarnAtMs = now;
            }
        }
        this._scheduleTickDrain();
    }

    _scheduleTickDrain() {
        if (this._tickDrainScheduled || this._isTickDraining) return;
        this._tickDrainScheduled = true;

        const schedule = global.setImmediate
            ? global.setImmediate
            : (fn) => setTimeout(fn, 0);

        schedule(() => {
            this._tickDrainScheduled = false;
            this._drainTickQueue().catch((error) => {
                logger.error(`MARKET_DATA: Tick drain failed: ${error.message}`);
            });
        });
    }

    async _drainTickQueue() {
        if (this._isTickDraining) return;
        this._isTickDraining = true;

        try {
            while (this._pendingTickBatches.length > 0) {
                let processed = 0;

                while (processed < this.tickProcessBatchSize && this._pendingTickBatches.length > 0) {
                    const batch = this._pendingTickBatches[0];
                    while (batch.index < batch.ticks.length && processed < this.tickProcessBatchSize) {
                        this._processSingleTick(batch.ticks[batch.index], batch.source);
                        batch.index += 1;
                        processed += 1;
                        this._queuedTickCount = Math.max(0, this._queuedTickCount - 1);
                    }

                    if (batch.index >= batch.ticks.length) {
                        this._pendingTickBatches.shift();
                    }
                }

                if (this._pendingTickBatches.length > 0) {
                    await new Promise((resolve) => {
                        if (global.setImmediate) {
                            setImmediate(resolve);
                            return;
                        }
                        setTimeout(resolve, 0);
                    });
                }
            }
        } finally {
            this._isTickDraining = false;
        }

        if (this._pendingTickBatches.length > 0) {
            this._scheduleTickDrain();
        }
    }

    _processSingleTick(tick, source) {
        if (!tick) return;

        let symbol = tick.symbol;

        if (source === 'kite' && tick.instrument_token) {
            const tokenTargets = this._resolveTokenTargets(tick.instrument_token);
            if (tokenTargets.length > 0) {
                symbol = tokenTargets[0];
            } else {
                symbol = this.tokenMap[String(tick.instrument_token)] || symbol;
            }
        }

        symbol = this._getCanonicalSymbol(symbol);
        if (!symbol) return;

        const lastPrice = toNumber(tick.last_price ?? tick.price ?? tick.last, NaN);
        if (!Number.isFinite(lastPrice)) return;

        const targetSymbolsSet = new Set();
        const addTargetSymbol = (candidate) => {
            const resolved = this._resolveAliasTargets(candidate);
            if (resolved.length === 0) {
                const canonical = this._getCanonicalSymbol(candidate);
                if (canonical) targetSymbolsSet.add(canonical);
                return;
            }
            for (const item of resolved) {
                targetSymbolsSet.add(item);
            }
        };

        if (source === 'kite' && tick.instrument_token) {
            const tokenTargets = this._resolveTokenTargets(tick.instrument_token);
            for (const candidate of tokenTargets) {
                addTargetSymbol(candidate);
            }
        }

        addTargetSymbol(symbol);

        if (targetSymbolsSet.size === 0) {
            targetSymbolsSet.add(symbol);
        }

        const targetSymbols = Array.from(targetSymbolsSet);

        for (const targetSymbol of targetSymbols) {
            this.currentPrices[targetSymbol] = lastPrice;
            const incomingSessionId =
                typeof tick.session_id === 'string' && tick.session_id.trim()
                    ? tick.session_id.trim()
                    : null;

            if (!this.currentQuotes[targetSymbol]) {
                this.currentQuotes[targetSymbol] = {
                    last_price: lastPrice,
                    ohlc: {
                        open: lastPrice,
                        high: lastPrice,
                        low: lastPrice,
                        close: lastPrice,
                    },
                    bid: 0,
                    ask: 0,
                    volume: 0,
                    session_id: incomingSessionId,
                };
            }

            const quote = this.currentQuotes[targetSymbol];
            quote.last_price = lastPrice;

            if (tick.ohlc) {
                const prevOpen = toNumber(quote.ohlc.open, lastPrice);
                const prevHigh = toNumber(quote.ohlc.high, lastPrice);
                const prevLow = toNumber(quote.ohlc.low, lastPrice);
                const incomingOpen = toNumber(tick.ohlc.open, prevOpen);
                const incomingHigh = toNumber(tick.ohlc.high, NaN);
                const incomingLow = toNumber(tick.ohlc.low, NaN);
                const incomingClose = toNumber(tick.ohlc.close, lastPrice);
                const open = Number.isFinite(incomingOpen) ? incomingOpen : prevOpen;
                const close = Number.isFinite(incomingClose) ? incomingClose : lastPrice;
                const prevSessionId =
                    typeof quote.session_id === 'string' && quote.session_id.trim()
                        ? quote.session_id.trim()
                        : null;
                const isSessionReset = Boolean(
                    incomingSessionId &&
                    prevSessionId &&
                    incomingSessionId !== prevSessionId
                );
                const high = Number.isFinite(incomingHigh)
                    ? (
                        isSessionReset
                            ? Math.max(incomingHigh, open, close, lastPrice)
                            : Math.max(prevHigh, incomingHigh, open, close, lastPrice)
                    )
                    : (
                        isSessionReset
                            ? Math.max(open, close, lastPrice)
                            : Math.max(prevHigh, open, close, lastPrice)
                    );
                const low = Number.isFinite(incomingLow)
                    ? (
                        isSessionReset
                            ? Math.min(incomingLow, open, close, lastPrice)
                            : Math.min(prevLow, incomingLow, open, close, lastPrice)
                    )
                    : (
                        isSessionReset
                            ? Math.min(open, close, lastPrice)
                            : Math.min(prevLow, open, close, lastPrice)
                    );

                quote.ohlc = {
                    open,
                    high,
                    low,
                    close,
                };
                if (incomingSessionId) {
                    quote.session_id = incomingSessionId;
                }
            } else {
                quote.ohlc.high = Math.max(toNumber(quote.ohlc.high, lastPrice), lastPrice);
                quote.ohlc.low = Math.min(toNumber(quote.ohlc.low, lastPrice), lastPrice);
                quote.ohlc.close = lastPrice;
                if (!Number.isFinite(quote.ohlc.open)) {
                    quote.ohlc.open = lastPrice;
                }
            }

            const newBid = toNumber(tick.bid ?? tick.depth?.buy?.[0]?.price, 0);
            const newAsk = toNumber(tick.ask ?? tick.depth?.sell?.[0]?.price, 0);
            if (newBid > 0) quote.bid = newBid;
            if (newAsk > 0) quote.ask = newAsk;

            const volume = toNumber(tick.total_volume ?? tick.volume ?? tick.last_quantity, quote.volume || 0);
            quote.volume = volume;

            const open = toNumber(quote.ohlc.open, lastPrice);
            const change = lastPrice - open;
            const changePercent = open > 0 ? (change / open) * 100 : 0;

            const payload = {
                symbol: targetSymbol,
                price: lastPrice,
                last_price: lastPrice,
                open,
                high: toNumber(quote.ohlc.high, lastPrice),
                low: toNumber(quote.ohlc.low, lastPrice),
                change,
                changePercent,
                volume,
                total_volume: volume,
                bid: quote.bid || 0,
                ask: quote.ask || 0,
                timestamp: tick.timestamp || new Date(),
                provider: source === 'kite' ? 'kite' : 'market_data',
            };

            this.emit('price_update', payload);
            pipeline.push(payload);
            this._persistSymbolPrice(targetSymbol);
        }

        if (source !== 'kite') {
            const candidateLatency = toNumber(tick._latencyMs, 0);
            if (candidateLatency > 0) {
                this.marketDataLatency = candidateLatency;
            }
        }
    }

    _persistSymbolPrice(symbol) {
        try {
            const now = Date.now();
            if (this._persistBlockedUntil && now < this._persistBlockedUntil) return;

            const lastAt = this._lastPersistedAt[symbol] || 0;
            if (now - lastAt < 60000) return;

            const quote = this.currentQuotes[symbol] || {};
            const lastPrice = toNumber(this.currentPrices[symbol], 0);
            const prevClose = toNumber(quote?.ohlc?.close, 0);

            this._lastPersistedAt[symbol] = now;

            MasterSymbol.findOneAndUpdate(
                { symbol },
                {
                    lastPrice,
                    prevClose: prevClose || undefined,
                    lastPriceUpdatedAt: new Date(now),
                },
                { new: false }
            ).catch((error) => {
                if (/ECONNRESET|Mongo|buffering timed out|disconnected|topology/i.test(String(error?.message || ''))) {
                    this._persistBlockedUntil = Date.now() + 60000;
                    logger.warn(`MARKET_DATA: Pausing DB price persistence for 60s after ${symbol} persist failure`);
                }
                logger.error(`MARKET_DATA: Failed persisting ${symbol}: ${error.message}`);
            });
        } catch (error) {
            logger.error(`MARKET_DATA: Persist error for ${symbol}: ${error.message}`);
        }
    }

    async loadSettings() {
        const nextConfig = {};

        try {
            const settings = await Setting.find({
                key: { $regex: '^(data_feed_|kite_|fmp_|market_data_|mt5_)' },
            });

            for (const setting of settings) {
                if (SENSITIVE_KEY_PATTERN.test(setting.key)) {
                    nextConfig[setting.key] = decrypt(setting.value);
                } else {
                    nextConfig[setting.key] = setting.value;
                }
            }
        } catch (error) {
            logger.warn(`MARKET_DATA: Settings load skipped: ${error.message}`);
        }

        if (process.env.KITE_API_KEY) nextConfig.kite_api_key = process.env.KITE_API_KEY;
        if (process.env.KITE_API_SECRET) nextConfig.kite_api_secret = process.env.KITE_API_SECRET;
        // Prefer DB-stored access token; only fall back to env if DB missing.
        if (!nextConfig.kite_access_token && process.env.KITE_ACCESS_TOKEN) {
            nextConfig.kite_access_token = process.env.KITE_ACCESS_TOKEN;
        }

        if (process.env.FMP_API_KEY) nextConfig.fmp_api_key = process.env.FMP_API_KEY;

        if (process.env.MARKET_DATA_WS_URL) nextConfig.market_data_ws_url = process.env.MARKET_DATA_WS_URL;
        if (!nextConfig.market_data_ws_url && process.env.MT5_WS_URL) {
            nextConfig.market_data_ws_url = process.env.MT5_WS_URL;
        }

        if (process.env.MARKET_DATA_API_KEY) nextConfig.market_data_api_key = process.env.MARKET_DATA_API_KEY;
        if (!nextConfig.market_data_api_key && process.env.MT5_WS_API_KEY) {
            nextConfig.market_data_api_key = process.env.MT5_WS_API_KEY;
        }

        if (process.env.MARKET_DATA_INTERVAL_MS) {
            nextConfig.market_data_interval_ms = Number.parseInt(process.env.MARKET_DATA_INTERVAL_MS, 10);
        } else if (!nextConfig.market_data_interval_ms && process.env.MT5_WS_INTERVAL_MS) {
            nextConfig.market_data_interval_ms = Number.parseInt(process.env.MT5_WS_INTERVAL_MS, 10);
        }

        if (process.env.DATA_FEED_PROVIDER) {
            nextConfig.data_feed_provider = String(process.env.DATA_FEED_PROVIDER).trim().toLowerCase();
        } else if (!nextConfig.data_feed_provider) {
            if (process.env.MARKET_DATA_WS_URL || process.env.MT5_WS_URL || nextConfig.market_data_ws_url) {
                nextConfig.data_feed_provider = 'market_data';
            } else if (nextConfig.kite_api_key) {
                nextConfig.data_feed_provider = 'kite';
            } else {
                nextConfig.data_feed_provider = 'none';
            }
        }

        this.config = nextConfig;

        if (this.config.kite_access_token) {
            kiteService.setAccessToken(this.config.kite_access_token);
        }

        if (String(process.env.DISABLE_LIVE_FEED || '').toLowerCase() === 'true') {
            logger.warn('MARKET_DATA: Live feed disabled via DISABLE_LIVE_FEED=true');
            return;
        }

        if (this.canGoLive()) {
            await this.startLiveFeed();
        }
    }

    canGoLive() {
        const hasKite = Boolean(this.config.kite_api_key && this.config.kite_api_secret);
        const hasMarketData = Boolean(this.config.market_data_ws_url);
        return hasKite || hasMarketData;
    }

    async startLiveFeed() {
        const tasks = [];

        if (this.config.kite_api_key && this.config.kite_api_secret) {
            tasks.push((async () => {
                try {
                    this.adapter = kiteService;
                    this.adapter.initialize(this.config.kite_api_key, this.config.kite_api_secret);

                    if (this.config.kite_access_token) {
                        this.adapter.setAccessToken(this.config.kite_access_token);
                        this.connectTicker();
                    } else {
                        logger.warn('MARKET_DATA: Kite configured but access token is missing.');
                    }
                } catch (error) {
                    logger.error(`MARKET_DATA: Kite init failed: ${error.message}`);
                }
            })());
        }

        if (this.config.market_data_ws_url) {
            tasks.push((async () => {
                try {
                    mt5Service.init({
                        url: this.config.market_data_ws_url,
                        apiKey: this.config.market_data_api_key,
                        intervalMs: Number.parseInt(this.config.market_data_interval_ms, 10) || 300,
                        marketDataService: this,
                    });

                    logger.info('MARKET_DATA: External market-data websocket initialized');
                } catch (error) {
                    logger.error(`MARKET_DATA: Market-data websocket init failed: ${error.message}`);
                }
            })());
        }

        await Promise.allSettled(tasks);
        this.mode = 'live';
        this.subscribeToSymbols();
    }

    connectTicker() {
        if (!this.adapter) return;

        this.adapter.connectTicker(
            (ticks) => this.processLiveTicks(ticks, 'kite'),
            () => {
                logger.info('MARKET_DATA: Kite ticker connected');
                this.subscribeToSymbols();
            }
        );
    }

    getStats(options = {}) {
        const includePrices = options.includePrices !== false;
        const marketDataStats = {
            connected: mt5Service.isConnected || false,
            latency: mt5Service.isConnected ? `${toNumber(this.marketDataLatency, 0)}ms` : 'Disconnected',
            tickCount: this.marketDataTickCount,
            subscribedSymbols: mt5Service.subscriptionCount || 0,
            diagnostics: mt5Service.getDiagnostics(),
        };

        const stats = {
            provider: this.config?.data_feed_provider || 'none',
            startTime: this.startTime,
            uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
            mode: this.mode,
            kite: {
                connected: this.adapter?.isTickerConnected || false,
                latency: this.adapter?.isTickerConnected ? `${toNumber(this.kiteLatency, 0)}ms` : 'Disconnected',
                tickCount: this.kiteTickCount,
            },
            marketData: marketDataStats,
            mt5: marketDataStats,
            alltick: marketDataStats,
        };

        if (stats.provider === 'kite') {
            stats.latency = stats.kite.latency;
            stats.tickCount = stats.kite.tickCount;
        } else {
            stats.latency = stats.marketData.latency;
            stats.tickCount = stats.marketData.tickCount;
        }

        if (includePrices) {
            stats.prices = this.currentPrices || {};
        }

        return stats;
    }

    async handleLogin(provider, payload = {}) {
        await this.loadSettings();

        if (provider === 'kite') {
            return this.handleKiteLogin(payload.request_token || payload.code);
        }

        throw new Error(`Login provider ${provider} is not supported`);
    }

    async handleKiteLogin(requestToken) {
        await this.loadSettings();

        if (!this.config.kite_api_key || !this.config.kite_api_secret) {
            throw new Error('Kite API credentials are not configured');
        }

        kiteService.initialize(this.config.kite_api_key, this.config.kite_api_secret);
        const response = await kiteService.generateSession(requestToken);

        await Setting.findOneAndUpdate(
            { key: 'kite_access_token' },
            {
                key: 'kite_access_token',
                value: encrypt(response.access_token),
                description: 'Kite Access Token',
            },
            { upsert: true }
        );

        this.config.kite_access_token = response.access_token;
        this.connectTicker();
        return response;
    }

    async getHistory(symbol, resolution, from, to, countOverride = null, options = {}) {
        let canonical = this._getCanonicalSymbol(symbol) || String(symbol || '').trim();
        if (!canonical) return [];
        const alias = this._resolveHistoryAlias(canonical);
        const historySymbol = alias || canonical;

        const fromTs = parseTs(from);
        const toTs = parseTs(to, Math.floor(Date.now() / 1000));
        try {
            const symbolDoc = this.symbols[historySymbol] || this.symbols[canonical] || null;
            const isIndianSymbol = this._isIndianSymbol(historySymbol, symbolDoc);
            const canUseKite = Boolean(
                this.config.kite_api_key &&
                this.config.kite_api_secret &&
                this.config.kite_access_token
            );
            // Only prefer Kite when (a) the symbol is clearly Indian (NSE/BSE/MCX/NFO/...) OR
            // (b) we have a symbol doc that indicates this is not a market-data (MT5) symbol.
            // This avoids mistakenly routing unknown non-Indian symbols to Kite.
            const shouldUseKite = canUseKite && (
                isIndianSymbol ||
                (symbolDoc && !this._isMarketDataSymbol(symbolDoc))
            );

            if (shouldUseKite) {
                const fromKey = Math.floor(fromTs / 30) * 30;
                const toKey = Math.floor(toTs / 30) * 30;
                const countKey = countOverride !== null && countOverride !== undefined
                    ? Number.parseInt(countOverride, 10) || 0
                    : 0;
                const cacheKey = `history_${historySymbol}_${resolution}_${fromKey}_${toKey}_${countKey}`;

                const cached = await cacheManager.get(cacheKey);
                if (Array.isArray(cached) && cached.length > 0) {
                    return cached.filter((candle) => candle && candle.time && candle.close !== undefined);
                }

                if (this.kiteAuthBrokenUntil && Date.now() < this.kiteAuthBrokenUntil) {
                    logger.warn(`MARKET_DATA: Skipping Kite history for ${historySymbol}; auth cooldown active`);
                    if (options?.throwOnAuthError) {
                        throw new ApiError(
                            httpStatus.UNAUTHORIZED,
                            'Zerodha/Kite session expired or invalid. Please reconnect Kite.'
                        );
                    }
                    return [];
                }

                // History requests may come in before `init()` finishes (server starts listening without awaiting it),
                // or with live feed disabled. Ensure Kite is usable for REST history fetches.
                try {
                    if (this.adapter !== kiteService) {
                        this.adapter = kiteService;
                    }
                    if (!kiteService.kite || kiteService.apiKey !== this.config.kite_api_key) {
                        kiteService.initialize(this.config.kite_api_key, this.config.kite_api_secret);
                    }
                    if (this.config.kite_access_token && kiteService.accessToken !== this.config.kite_access_token) {
                        kiteService.setAccessToken(this.config.kite_access_token);
                    }
                } catch (error) {
                    logger.warn(`MARKET_DATA: Failed ensuring Kite client for history: ${error.message}`);
                }

                let kiteInstrument =
                    symbolDoc?.instrumentToken ||
                    kiteInstrumentsService.getInstrumentBySymbol(historySymbol)?.instrument_token ||
                    kiteInstrumentsService.getInstrumentBySymbol(canonical)?.instrument_token ||
                    null;

                // For most user-added NSE/MCX symbols we won't have an instrument token stored upfront.
                // Resolve the token on-demand so charts don't render empty.
                if (!kiteInstrument) {
                    const exchangeFallback = String(
                        canonical.includes(':')
                            ? canonical.split(':')[0]
                            : historySymbol.includes(':')
                                ? historySymbol.split(':')[0]
                                : symbolDoc?.exchange || ''
                    )
                        .trim()
                        .toUpperCase();

                    const tokenDoc = symbolDoc || {
                        symbol: canonical,
                        ...(exchangeFallback ? { exchange: exchangeFallback } : {}),
                    };

                    const resolvedToken = await this._ensureKiteInstrumentToken(tokenDoc);
                    if (resolvedToken) {
                        kiteInstrument = resolvedToken;
                    }
                }

                if (!kiteInstrument) {
                    logger.warn(`MARKET_DATA: Unable to resolve Kite instrument token for history ${historySymbol}`);
                    return [];
                }

                const data = await this._fetchKiteHistory(
                    historySymbol,
                    resolution,
                    new Date(fromTs * 1000),
                    new Date(toTs * 1000),
                    kiteInstrument,
                    countOverride
                );

                const filtered = Array.isArray(data)
                    ? data.filter((candle) => candle && candle.time && candle.close !== undefined)
                    : [];

                // Avoid caching empty arrays: history may be empty due to transient auth/token issues.
                if (filtered.length > 0) {
                    await cacheManager.set(cacheKey, filtered, '24h');
                }

                return filtered;
            }

            if (isIndianSymbol) {
                logger.warn(`MARKET_DATA: Skipping MT5 history for Indian symbol ${historySymbol}`);
                return [];
            }

            const marketDataHistory = await this._fetchMarketDataHistory(
                historySymbol,
                resolution,
                fromTs,
                toTs,
                countOverride
            );
            if (marketDataHistory.length > 0) {
                return marketDataHistory;
            }

            // External market-data websocket fallback: best-effort snapshot candle.
            const livePrice = toNumber(this.currentPrices[canonical], 0);
            const quote = this.currentQuotes[canonical];

            if (quote?.ohlc) {
                return [{
                    time: toTs,
                    open: toNumber(quote.ohlc.open, livePrice),
                    high: toNumber(quote.ohlc.high, livePrice),
                    low: toNumber(quote.ohlc.low, livePrice),
                    close: toNumber(quote.ohlc.close, livePrice),
                    volume: toNumber(quote.volume, 0),
                }];
            }

            return [];
        } catch (error) {
            const message = String(error?.message || '');
            const lower = message.toLowerCase();
            const statusCode = Number(
                error?.status ||
                error?.statusCode ||
                error?.response?.status ||
                0
            );

            const isAuthError = (
                statusCode === 401 ||
                statusCode === 403 ||
                lower.includes('403') ||
                lower.includes('401') ||
                (lower.includes('incorrect') && (lower.includes('api_key') || lower.includes('access_token')))
            );

            // If the access token was updated in DB while the server is running, refresh settings once and retry.
            if (
                isAuthError &&
                options?.reloadSettingsOnAuthError !== false &&
                !options?._retriedAfterSettingsReload
            ) {
                try {
                    await this.loadSettings();
                } catch (reloadError) {
                    logger.warn(`MARKET_DATA: Failed reloading settings after auth error: ${reloadError.message}`);
                }

                return await this.getHistory(symbol, resolution, from, to, countOverride, {
                    ...options,
                    _retriedAfterSettingsReload: true,
                });
            }

            if (isAuthError) {
                this.kiteAuthBrokenUntil = Date.now() + 5 * 60 * 1000;

                if (options?.throwOnAuthError) {
                    throw new ApiError(
                        httpStatus.UNAUTHORIZED,
                        'Zerodha/Kite session expired or invalid. Please reconnect Kite.'
                    );
                }
            }

            logger.error(`MARKET_DATA: History fetch failed for ${canonical}: ${message}`);
            return [];
        }
    }

    async _fetchKiteHistory(symbol, resolution, from, to, instrumentTokenOverride = null, countOverride = null) {
        const symbolDoc = this.symbols[symbol];
        const instrumentToken = instrumentTokenOverride || symbolDoc?.instrumentToken;
        if (!instrumentToken) return [];

        const sourceResolution = isAggregatedResolution(resolution) ? 'D' : resolution;
        const interval = resolutionToKiteInterval(sourceResolution);

        const safeFromTs = parseTs(from);
        const safeToTs = parseTs(to);

        const adjustedFromTs = safeFromTs > safeToTs ? safeToTs - 86400 : safeFromTs;

        const candles = await kiteService.getHistoricalData(
            instrumentToken,
            interval,
            new Date(adjustedFromTs * 1000),
            new Date(safeToTs * 1000)
        );

        return aggregateCandlesForResolution(candles, resolution, countOverride);
    }

    _resolveMarketDataHttpBase() {
        const explicit = String(
            process.env.MARKET_DATA_HTTP_URL ||
            process.env.MARKET_DATA_API_URL ||
            ''
        ).trim();
        if (explicit) {
            return explicit.replace(/\/+$/, '');
        }

        const wsUrl = String(this.config?.market_data_ws_url || '').trim();
        if (!wsUrl) return '';
        const protocolFixed = wsUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
        const stripped = protocolFixed.replace(/\/ws\/market.*$/i, '');
        return stripped.replace(/\/+$/, '');
    }

    _getMarketDataHistoryCount(override = null) {
        const baseRaw = override !== null && override !== undefined
            ? Number.parseInt(override, 10)
            : Number.parseInt(process.env.MARKET_DATA_HISTORY_COUNT || '500', 10);
        if (!Number.isFinite(baseRaw) || baseRaw <= 0) return 500;
        const bounded = Math.max(baseRaw, 500);
        return Math.min(bounded, 2000);
    }

    _normalizeMarketDataHistory(rows = []) {
        return rows
            .map((item) => {
                if (!item || typeof item !== 'object') return null;
                const timeRaw = item.time ?? item.timestamp ?? item.t;
                let time = Number(timeRaw);
                if (!Number.isFinite(time)) return null;
                if (time > 10_000_000_000) time = Math.floor(time / 1000);

                const open = toNumber(item.open, NaN);
                const high = toNumber(item.high, NaN);
                const low = toNumber(item.low, NaN);
                const close = toNumber(item.close, NaN);
                if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
                    return null;
                }
                return {
                    time,
                    open,
                    high,
                    low,
                    close,
                    volume: toNumber(item.volume, 0),
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.time - b.time);
    }

    async _fetchMarketDataHistory(symbol, resolution, fromTs, toTs, countOverride = null) {
        const baseUrl = this._resolveMarketDataHttpBase();
        if (!baseUrl) return [];

        try {
            const count = this._getMarketDataHistoryCount(countOverride);
            const params = {
                symbol,
                resolution,
                count,
                from: fromTs,
                to: toTs,
            };
            const headers = this.config.market_data_api_key
                ? { 'x-api-key': this.config.market_data_api_key }
                : undefined;
            const response = await axios.get(`${baseUrl}/api/history`, {
                params,
                headers,
                timeout: 8000,
            });
            const data = response.data;
            const rows = Array.isArray(data)
                ? data
                : Array.isArray(data?.candles)
                    ? data.candles
                    : [];
            return this._normalizeMarketDataHistory(rows);
        } catch (error) {
            logger.warn(`MARKET_DATA: History API failed for ${symbol}: ${error.message}`);
            return [];
        }
    }

    async searchInstruments(query = '') {
        const safeQuery = typeof query === 'string' ? query.trim() : '';

        try {
            const version = await this._getSymbolsCacheVersion();
            const normalizedQuery = safeQuery.toLowerCase() || 'all';
            const cacheKey = `symbol_search_v${version}_${normalizedQuery}`;

            return await cacheManager.getOrFetch(cacheKey, async () => {
                const dbFilter = safeQuery
                    ? {
                        $or: [
                            { symbol: { $regex: safeQuery, $options: 'i' } },
                            { name: { $regex: safeQuery, $options: 'i' } },
                        ],
                    }
                    : {};

                const dbSymbols = await MasterSymbol.find(dbFilter)
                    .sort({ symbol: 1 })
                    .limit(50)
                    .lean();

                const dbMapped = dbSymbols
                    .filter((item) => isCurrentMonthContractDoc({ symbol: item.symbol, name: item.name }))
                    .map((item) => ({
                    symbol: item.symbol,
                    name: item.name,
                    segment: item.segment,
                    exchange: item.exchange,
                    provider: item.provider || null,
                    lotSize: item.lotSize || 1,
                    tickSize: item.tickSize || 0.01,
                    instrumentToken: item.instrumentToken || null,
                }))
                    .map((item) => decorateSymbolSegment(item));

                return dedupeSymbols(dbMapped).slice(0, 50);
            }, SYMBOL_SEARCH_CACHE_TTL);
        } catch (error) {
            logger.error(`MARKET_DATA: Search failed: ${error.message}`);
            return [];
        }
    }

    async syncInstruments() {
        try {
            await this.loadSettings();

            if (!this.config.kite_api_key || !this.config.kite_api_secret) {
                return {
                    synced: false,
                    provider: 'kite',
                    message: 'Kite API key/secret not configured',
                };
            }

            if (!this.config.kite_access_token) {
                return {
                    synced: false,
                    provider: 'kite',
                    message: 'Kite access token missing. Login first.',
                };
            }

            kiteService.initialize(this.config.kite_api_key, this.config.kite_api_secret);
            kiteService.setAccessToken(this.config.kite_access_token);

            const result = await kiteInstrumentsService.syncFromZerodha();
            const cleanupResult = await this.cleanupStaleDerivativeContracts();
            await this.loadMasterSymbols({ forceReload: true });
            await this.refreshSymbolsCache({ bumpVersion: true });
            return {
                synced: true,
                provider: 'kite',
                count: result?.count || 0,
                nfoFutures: result?.nfoFutures || 0,
                removedStaleContracts: cleanupResult.deletedCount || 0,
            };
        } catch (error) {
            logger.error(`MARKET_DATA: Instrument sync failed: ${error.message}`);
            return {
                synced: false,
                provider: 'kite',
                message: error.message,
            };
        }
    }
}

const marketDataService = new MarketDataService();
export default marketDataService;

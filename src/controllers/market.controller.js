import httpStatus from 'http-status';
import mongoose from 'mongoose';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import MasterSegment from '../models/MasterSegment.js';
import MasterSymbol from '../models/MasterSymbol.js';
import MarketWatchlistTemplate from '../models/MarketWatchlistTemplate.js';
import config from '../config/config.js';
import logger from '../config/log.js';
import { buildMasterSymbolId } from '../utils/masterSymbolId.js';
import {
    decorateSymbolSegment,
    matchesSegmentGroup,
    normalizeUpper,
    resolveSymbolSegmentGroup,
} from '../utils/marketSegmentResolver.js';
import {
    buildAliasBackedMarketSymbol,
    getMarketAliasLookupSymbols,
    getMatchingMarketSymbolAliases,
    getMarketSymbolAliasDefinition,
    isUnsupportedWatchlistSymbol,
} from '../utils/marketSymbolAliases.js';
import { dedupeSymbols } from '../utils/marketSymbolDedupe.js';
import { SEED_SYMBOLS } from '../config/seedSymbols.js';
import { DEFAULT_MARKET_WATCHLIST_TEMPLATES } from '../config/defaultMarketWatchlistTemplates.js';
import { getActiveMarketWatchlistTemplates } from '../services/marketWatchlistTemplate.service.js';
import {
    MAX_SELECTED_SYMBOLS_PER_SEGMENT,
    buildSelectedSymbolDocsMap,
    getSelectionBucketKey,
    limitSelectedSymbolsPerSegment,
    normalizeSelectedSymbols,
} from '../utils/userSignalSelection.js';
import { isCurrentMonthContractDoc } from '../utils/currentMonthContracts.js';

// Seed Data (Standard Set)
import marketDataService from '../services/marketData.service.js';
import { kiteService } from '../services/kite.service.js';
import subscriptionService from '../services/subscription.service.js';
import { technicalAnalysisService } from '../services/index.js';
import fmpService from '../services/fmp.service.js';

const toNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

const parseBooleanQuery = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;

    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'active', 'with_id', 'withid'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'inactive', 'missing_id', 'missingid'].includes(normalized)) return false;
    return undefined;
};

const parseIntegerQuery = (value, fallback, min, max) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
};

const slugifyKey = (value = '') =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

const normalizeTemplateSelectorInput = (selector = {}) => {
    const raw = selector && typeof selector === 'object' ? selector : {};
    const normalizeArray = (values = []) =>
        Array.from(
            new Set(
                (Array.isArray(values) ? values : [])
                    .map((value) => String(value || '').trim().toUpperCase())
                    .filter(Boolean)
            )
        );

    return {
        bucket: String(raw.bucket || '').trim().toUpperCase(),
        segments: normalizeArray(raw.segments),
        exchanges: normalizeArray(raw.exchanges),
        symbolPrefixes: normalizeArray(raw.symbolPrefixes),
        symbolIncludes: normalizeArray(raw.symbolIncludes),
        nameIncludes: normalizeArray(raw.nameIncludes),
    };
};

const normalizeTemplatePayload = (payload = {}) => {
    const name = String(payload?.name || '').trim();
    if (!name) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Template name is required');
    }

    const key = String(payload?.key || '').trim().toLowerCase() || slugifyKey(name);
    if (!key) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Template key is required');
    }

    const symbolLimitRaw = Number(payload?.symbolLimit);
    const symbolLimit = Number.isFinite(symbolLimitRaw)
        ? Math.min(Math.max(Math.floor(symbolLimitRaw), 1), 50)
        : 25;

    const preferredSymbols = Array.from(
        new Set(
            (Array.isArray(payload?.preferredSymbols) ? payload.preferredSymbols : [])
                .map((value) => String(value || '').trim().toUpperCase())
                .filter(Boolean)
        )
    );

    return {
        key,
        name,
        order: Number.isFinite(Number(payload?.order)) ? Number(payload.order) : 100,
        isActive: payload?.isActive !== false,
        symbolLimit,
        preferredSymbols,
        selector: normalizeTemplateSelectorInput(payload?.selector || {}),
    };
};

const resolutionToSeconds = (resolution) => {
    const normalized = String(resolution || '').trim().toUpperCase();
    if (!normalized) return 60;
    if (normalized === 'D' || normalized === '1D' || normalized === 'DAY') return 24 * 60 * 60;
    if (normalized === 'W' || normalized === '1W' || normalized === 'WEEK') return 7 * 24 * 60 * 60;
    if (normalized === 'M' || normalized === '1M' || normalized === 'MN') return 30 * 24 * 60 * 60;
    if (normalized.endsWith('H')) {
        const hours = Number.parseInt(normalized.replace('H', ''), 10);
        if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60;
    }
    const minutes = Number.parseInt(normalized, 10);
    if (Number.isFinite(minutes) && minutes > 0) return minutes * 60;
    return 60;
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isCryptoSpotItem = (item = {}) => {
    const segmentGroup = normalizeUpper(item.segmentGroup || item.segment);
    if (segmentGroup !== 'CRYPTO') return true;

    const symbol = normalizeUpper(item.symbol);
    const name = normalizeUpper(item.name);

    const nonSpotSymbolHints = [
        '.P',
        '.PERP',
        '.LV',
        'PERP',
        'PERPETUAL',
        'FUT',
        'SWAP',
    ];

    const nonSpotNameHints = [
        'PERP',
        'PERPETUAL',
        'FUT',
        'FUTURE',
        'SWAP',
        'LEVERAGE',
        'LEVERAGED',
    ];

    if (nonSpotSymbolHints.some((hint) => symbol.includes(hint))) return false;
    if (nonSpotNameHints.some((hint) => name.includes(hint))) return false;

    return true;
};

const preferCryptoUsdOverUsdt = (items = []) => {
    const usdBases = new Set();
    const normalizedItems = Array.isArray(items) ? items : [];

    for (const item of normalizedItems) {
        const segmentGroup = normalizeUpper(item.segmentGroup || item.segment);
        if (segmentGroup !== 'CRYPTO') continue;
        const symbol = normalizeUpper(item.symbol);
        if (symbol.endsWith('USD') && !symbol.endsWith('USDT')) {
            usdBases.add(symbol.slice(0, -3));
        }
    }

    if (usdBases.size === 0) return normalizedItems;

    return normalizedItems.filter((item) => {
        const segmentGroup = normalizeUpper(item.segmentGroup || item.segment);
        if (segmentGroup !== 'CRYPTO') return true;
        const symbol = normalizeUpper(item.symbol);
        if (symbol.endsWith('USDT')) {
            const base = symbol.slice(0, -4);
            return !usdBases.has(base);
        }
        return true;
    });
};

const resolvePreferredCryptoSpotSymbol = async (symbol = '') => {
    const normalized = normalizeUpper(symbol);
    if (!normalized.endsWith('USDT')) return normalized;

    const usdCandidate = normalized.slice(0, -1); // BTCUSDT -> BTCUSD
    if (!usdCandidate || usdCandidate === normalized) return normalized;

    const usdDoc = await MasterSymbol.findOne({ symbol: usdCandidate })
        .select('symbol')
        .lean();
    return usdDoc?.symbol ? usdCandidate : normalized;
};

const buildSymbolDocMap = (docs = []) => new Map(
    (Array.isArray(docs) ? docs : []).map((doc) => [normalizeUpper(doc?.symbol), doc])
);

const resolveAliasBackedSymbolDoc = (symbol = '', docsBySymbol = new Map()) => {
    const normalized = normalizeUpper(symbol);
    if (!normalized) return null;

    const exact = docsBySymbol.get(normalized);
    if (exact) return exact;

    const definition = getMarketSymbolAliasDefinition(normalized);
    if (!definition) return null;

    const canonicalDoc = docsBySymbol.get(definition.canonical);
    return buildAliasBackedMarketSymbol(normalized, canonicalDoc);
};

const findSymbolDocBySymbolOrAlias = async (symbol = '') => {
    const normalized = normalizeUpper(symbol);
    if (!normalized) return null;

    const docs = await MasterSymbol.find({ symbol: { $in: getMarketAliasLookupSymbols(normalized) } })
        .lean();
    return resolveAliasBackedSymbolDoc(normalized, buildSymbolDocMap(docs));
};

const buildSymbolFilter = (query = {}, { ignoreSegment = false } = {}) => {
    const clauses = [];
    const search = String(query.search || '').trim();
    const segment = String(query.segment || '').trim();
    const watchlist = parseBooleanQuery(query.watchlist);
    const isActive = parseBooleanQuery(query.isActive);
    const tradingViewAdded = parseBooleanQuery(query.tradingViewAdded);
    const hasSymbolId = parseBooleanQuery(
        query.hasSymbolId ?? (
            query.idStatus === 'with_id' || query.idStatus === 'withId'
                ? 'true'
                : query.idStatus === 'missing_id' || query.idStatus === 'missingId'
                    ? 'false'
                    : undefined
        )
    );

    if (segment && !ignoreSegment) clauses.push({ segment: normalizeUpper(segment) });
    if (watchlist !== undefined) clauses.push({ isWatchlist: watchlist });
    if (isActive !== undefined) clauses.push({ isActive });
    if (tradingViewAdded !== undefined) clauses.push({ tradingViewAdded });

    if (hasSymbolId === true) {
        clauses.push({ symbolId: { $exists: true, $ne: '' } });
    } else if (hasSymbolId === false) {
        clauses.push({
            $or: [
                { symbolId: { $exists: false } },
                { symbolId: null },
                { symbolId: '' }
            ]
        });
    }

    if (search) {
        const regex = new RegExp(escapeRegex(search), 'i');
        const searchClauses = [
            { symbol: regex },
            { name: regex },
            { symbolId: regex }
        ];

        if (mongoose.Types.ObjectId.isValid(search)) {
            searchClauses.push({ _id: new mongoose.Types.ObjectId(search) });
        }

        clauses.push({ $or: searchClauses });
    }

    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0];
    return { $and: clauses };
};

const enrichSymbol = (symbolLike) => {
    const symbol = decorateSymbolSegment(typeof symbolLike?.toObject === 'function' ? symbolLike.toObject() : { ...symbolLike });
    symbol.lastPrice = marketDataService.getBestLivePrice(symbol.symbol, symbol, symbol.lastPrice || 0);
    symbol.ltp = symbol.lastPrice;
    symbol.tradingViewAdded = Boolean(symbol.tradingViewAdded);

    const quote = marketDataService.getBestQuote(symbol.symbol, symbol);
    if (quote?.ohlc) {
        symbol.ohlc = quote.ohlc;
    }

    return symbol;
};

const normalizeSymbolPayload = (payload = {}) => {
    const nextPayload = payload;
    if (nextPayload.symbol) {
        nextPayload.symbol = normalizeUpper(nextPayload.symbol);
    }
    if (nextPayload.exchange) {
        nextPayload.exchange = normalizeUpper(nextPayload.exchange);
    }
    nextPayload.segment = resolveSymbolSegmentGroup(nextPayload);
    return nextPayload;
};

const hydrateInstrumentToken = async (payload = {}, previousSymbol = '') => {
    if (!payload?.symbol) return;

    const nextSymbol = String(payload.symbol).trim().toUpperCase();
    payload.symbol = nextSymbol;

    if (nextSymbol.includes('USDT')) {
        payload.segment = 'CRYPTO';
        payload.exchange = 'CRYPTO';
    }

    const shouldRefreshInstrumentToken =
        !payload.instrumentToken ||
        (previousSymbol && previousSymbol !== nextSymbol);

    if (!shouldRefreshInstrumentToken) return;

    payload.instrumentToken = undefined;

    const existing = await MasterSymbol.findOne({ symbol: nextSymbol })
        .select('instrumentToken')
        .lean();
    if (existing?.instrumentToken) {
        payload.instrumentToken = String(existing.instrumentToken);
        return;
    }

    const instrument = kiteInstrumentsService.getInstrumentBySymbol(nextSymbol);
    if (instrument) {
        payload.instrumentToken = String(instrument.instrument_token);
        return;
    }

    if (nextSymbol.endsWith('-EQ')) {
        const raw = nextSymbol.replace('-EQ', '');
        const fallbackDoc = await MasterSymbol.findOne({ symbol: raw })
            .select('instrumentToken')
            .lean();
        if (fallbackDoc?.instrumentToken) {
            payload.instrumentToken = String(fallbackDoc.instrumentToken);
            return;
        }
        const fallbackInstrument = kiteInstrumentsService.getInstrumentBySymbol(raw);
        if (fallbackInstrument) {
            payload.instrumentToken = String(fallbackInstrument.instrument_token);
        }
    }
};

const enrichMarketSymbols = (symbols) => {
    return symbols.map(s => {
        const fallbackLive = (s.lastPrice && s.lastPrice > 0) ? s.lastPrice : (s.prevClose && s.prevClose > 0 ? s.prevClose : 0);
        const live = toNumber(marketDataService.getBestLivePrice(s.symbol, s, fallbackLive), 0);
        const quote = marketDataService.getBestQuote(s.symbol, s);
        const ohlc = quote?.ohlc;
        const close = toNumber(ohlc?.close, (s.prevClose && s.prevClose > 0 ? s.prevClose : live));
        const high = toNumber(ohlc?.high, live);
        const low = toNumber(ohlc?.low, live);
        const open = toNumber(ohlc?.open, close || live);
        const bid = toNumber(quote?.bid, 0);
        const ask = toNumber(quote?.ask, 0);
        const points = live - close;
        
        let change = 0;
        if (close > 0 && live > 0) {
            change = ((live - close) / close) * 100;
        }

        return {
            symbol: s.symbol,
            name: s.name,
            segment: s.segment,
            segmentGroup: resolveSymbolSegmentGroup(s),
            exchange: s.exchange,
            isLocked: Boolean(s.isLocked),
            provider: s.provider || null,
            price: live,
            prevClose: Number.isFinite(close) ? close : 0,
            close: Number.isFinite(close) ? close : 0,
            open: Number.isFinite(open) ? open : 0,
            high: Number.isFinite(high) ? high : 0,
            low: Number.isFinite(low) ? low : 0,
            bid: Number.isFinite(bid) && bid > 0 ? bid : 0,
            ask: Number.isFinite(ask) && ask > 0 ? ask : 0,
            points: Number.isFinite(points) ? points : 0,
            change: Number.isFinite(change) ? parseFloat(change.toFixed(2)) : 0,
            isUp: change >= 0,
            lotSize: s.lotSize || 1,
            color: change >= 0 ? '#22C55E' : '#EF4444'
        };
    });
};

const MAX_MARKET_WATCHLISTS = 50;
const MIN_MARKET_WATCHLIST_NAME_LENGTH = 2;
const MAX_MARKET_WATCHLIST_NAME_LENGTH = 48;
const DEFAULT_MARKET_WATCHLIST_NAME = 'My Watchlist';
const SYSTEM_ALL_WATCHLIST_NAME = 'All';
const DEFAULT_PRELOADED_WATCHLIST_SYMBOL_LIMIT = 10;

const createMarketWatchlistId = () => new mongoose.Types.ObjectId().toHexString();

const normalizeMarketWatchlistName = (value = '') =>
    String(value || '')
        .trim()
        .replace(/\s+/g, ' ');

const isSameSymbolOrder = (left = [], right = []) =>
    left.length === right.length && left.every((symbol, index) => symbol === right[index]);

const createUsedWatchlistNameMap = (watchlists = []) => {
    const usedNameMap = new Map();
    for (const item of Array.isArray(watchlists) ? watchlists : []) {
        const normalizedName = normalizeMarketWatchlistName(item?.name);
        if (!normalizedName) continue;
        usedNameMap.set(normalizedName.toLowerCase(), 1);
    }
    return usedNameMap;
};

const makeUniqueWatchlistName = (baseName, usedNameMap) => {
    const normalizedBase = normalizeMarketWatchlistName(baseName) || DEFAULT_MARKET_WATCHLIST_NAME;
    const key = normalizedBase.toLowerCase();

    if (!usedNameMap.has(key)) {
        usedNameMap.set(key, 1);
        return normalizedBase;
    }

    let suffix = usedNameMap.get(key) + 1;
    let candidate = `${normalizedBase} ${suffix}`;
    while (usedNameMap.has(candidate.toLowerCase())) {
        suffix += 1;
        candidate = `${normalizedBase} ${suffix}`;
    }
    usedNameMap.set(key, suffix);
    usedNameMap.set(candidate.toLowerCase(), 1);
    return candidate;
};

const PRELOADED_TEMPLATE_NAME_SET = new Set(
    DEFAULT_MARKET_WATCHLIST_TEMPLATES.map((item) =>
        normalizeMarketWatchlistName(item?.name).toLowerCase()
    )
);

const isSystemAllWatchlistName = (name = '') =>
    normalizeMarketWatchlistName(name).toLowerCase() === SYSTEM_ALL_WATCHLIST_NAME.toLowerCase();

const isTemplateWatchlistName = (name = '') =>
    PRELOADED_TEMPLATE_NAME_SET.has(normalizeMarketWatchlistName(name).toLowerCase());

const stripPreloadedWatchlists = (watchlists = [], activeWatchlistId = '') => {
    if (!Array.isArray(watchlists) || watchlists.length === 0) {
        return { watchlists: [], activeWatchlistId: '' };
    }

    const isTemplate = (name = '') =>
        PRELOADED_TEMPLATE_NAME_SET.has(normalizeMarketWatchlistName(name).toLowerCase());

    const customWatchlists = watchlists.filter((item) => !isTemplate(item?.name));
    if (customWatchlists.length > 0) {
        const resolvedActiveId = customWatchlists.some((item) => item.id === activeWatchlistId)
            ? activeWatchlistId
            : customWatchlists[0].id;
        return { watchlists: customWatchlists, activeWatchlistId: resolvedActiveId };
    }

    const fallbackActive = watchlists.find((item) => item.id === activeWatchlistId) || watchlists[0];
    if (!fallbackActive) {
        return { watchlists: [], activeWatchlistId: '' };
    }

    const usedNameMap = createUsedWatchlistNameMap([]);
    const renamed = {
        ...fallbackActive,
        name: makeUniqueWatchlistName(DEFAULT_MARKET_WATCHLIST_NAME, usedNameMap),
        isDefault: true,
        updatedAt: new Date(),
    };

    return { watchlists: [renamed], activeWatchlistId: renamed.id };
};

const buildInitialMarketWatchlists = (rawWatchlists = [], fallbackSymbols = []) => {
    const source = Array.isArray(rawWatchlists) ? rawWatchlists : [];
    const usedNameMap = new Map();
    const watchlists = source.map((item, index) => {
        const sourceItem = item && typeof item === 'object' ? item : {};
        const id = String(sourceItem.id || '').trim() || createMarketWatchlistId();
        const preferredName =
            normalizeMarketWatchlistName(sourceItem.name) || `Watchlist ${index + 1}`;
        const name = makeUniqueWatchlistName(preferredName, usedNameMap);
        const symbols = normalizeSelectedSymbols(sourceItem.symbols);
        const hasCustomSymbols = Object.prototype.hasOwnProperty.call(sourceItem, 'customSymbols');
        const customSymbols = hasCustomSymbols
            ? normalizeSelectedSymbols(sourceItem.customSymbols)
            : null;
        const templateKey = String(sourceItem.templateKey || '').trim().toLowerCase() || undefined;
        const createdAt = sourceItem.createdAt ? new Date(sourceItem.createdAt) : new Date();
        const updatedAt = sourceItem.updatedAt ? new Date(sourceItem.updatedAt) : createdAt;

        return {
            id,
            name,
            symbols,
            customSymbols,
            templateKey,
            isDefault: Boolean(sourceItem.isDefault),
            createdAt,
            updatedAt,
        };
    });

    if (watchlists.length === 0) {
        const normalizedFallback = normalizeSelectedSymbols(fallbackSymbols);
        const now = new Date();
        watchlists.push({
            id: createMarketWatchlistId(),
            name: DEFAULT_MARKET_WATCHLIST_NAME,
            symbols: normalizedFallback,
            isDefault: true,
            createdAt: now,
            updatedAt: now,
        });
    }

    return watchlists;
};

const normalizeSymbolDoc = (doc = {}) => ({
    ...doc,
    symbol: String(doc?.symbol || '').trim().toUpperCase(),
    segment: String(doc?.segment || '').trim().toUpperCase(),
    exchange: String(doc?.exchange || '').trim().toUpperCase(),
    name: String(doc?.name || '').trim(),
});

const findDocBySymbolHint = (docsBySymbol = new Map(), symbolHint = '') => {
    const normalizedHint = String(symbolHint || '').trim().toUpperCase();
    if (!normalizedHint) return null;

    if (docsBySymbol.has(normalizedHint)) {
        return docsBySymbol.get(normalizedHint);
    }

    const suffix = normalizedHint.includes(':')
        ? normalizedHint.split(':').pop()
        : normalizedHint;
    if (!suffix) return null;

    if (docsBySymbol.has(suffix)) {
        return docsBySymbol.get(suffix);
    }

    for (const [symbol, doc] of docsBySymbol.entries()) {
        if (symbol === suffix || symbol.endsWith(`:${suffix}`)) {
            return doc;
        }
    }

    return null;
};

const pickTopTemplateSymbols = (symbolDocs = [], docsBySymbol = new Map(), template = {}) => {
    const selected = [];
    const seen = new Set();

    const tryAddDoc = (doc) => {
        if (!doc?.symbol) return;
        const symbol = String(doc.symbol).trim().toUpperCase();
        if (!symbol || seen.has(symbol)) return;
        seen.add(symbol);
        selected.push(symbol);
    };

    const preferredSymbols = Array.isArray(template.preferredSymbols)
        ? template.preferredSymbols
        : [];
    for (const hint of preferredSymbols) {
        const preferredDoc = findDocBySymbolHint(docsBySymbol, hint);
        // Preferred symbols should be honored even when segment metadata is imperfect.
        tryAddDoc(preferredDoc);
    }

    return selected;
};

const buildPreloadedTemplateWatchlists = async (templates = [], templateNameSet = null) => {
    const targetTemplates = (Array.isArray(templates) ? templates : []).filter((template) => {
        if (!(templateNameSet instanceof Set) || templateNameSet.size === 0) return true;
        return templateNameSet.has(String(template.name || '').trim().toLowerCase());
    });
    if (targetTemplates.length === 0) return [];

    const preloadedWatchlists = [];
    for (const template of targetTemplates) {
        const symbols = normalizeSelectedSymbols(
            Array.isArray(template?.preferredSymbols) ? template.preferredSymbols : []
        );
        preloadedWatchlists.push({
            key: String(template?.key || '').trim().toLowerCase(),
            name: template.name,
            symbols,
        });
    }

    return preloadedWatchlists;
};

const buildPreloadedMarketWatchlists = async (templates = [], fallbackSymbols = []) => {
    const normalizedFallback = normalizeSelectedSymbols(fallbackSymbols).slice(
        0,
        DEFAULT_PRELOADED_WATCHLIST_SYMBOL_LIMIT
    );
    const usedNameMap = new Map();
    const watchlists = [];

    if (normalizedFallback.length > 0) {
        const now = new Date();
        watchlists.push({
            id: createMarketWatchlistId(),
            name: makeUniqueWatchlistName(DEFAULT_MARKET_WATCHLIST_NAME, usedNameMap),
            symbols: normalizedFallback,
            customSymbols: [],
            isDefault: true,
            createdAt: now,
            updatedAt: now,
        });
    }

    const templateWatchlists = await buildPreloadedTemplateWatchlists(templates);
    for (const template of templateWatchlists) {
        const now = new Date();
        watchlists.push({
            id: createMarketWatchlistId(),
            name: makeUniqueWatchlistName(template.name, usedNameMap),
            symbols: template.symbols,
            customSymbols: [],
            templateKey: String(template.key || '').trim().toLowerCase() || undefined,
            isDefault: false,
            createdAt: now,
            updatedAt: now,
        });
    }

    if (watchlists.length === 0) {
        const now = new Date();
        watchlists.push({
            id: createMarketWatchlistId(),
            name: makeUniqueWatchlistName(DEFAULT_MARKET_WATCHLIST_NAME, usedNameMap),
            symbols: normalizedFallback,
            customSymbols: [],
            isDefault: true,
            createdAt: now,
            updatedAt: now,
        });
    } else if (!watchlists.some((item) => item.isDefault)) {
        watchlists[0].isDefault = true;
    }

    return watchlists;
};

const appendMissingPreloadedWatchlists = async (
    watchlists = [],
    templates = [],
    missingTemplateNames = []
) => {
    if (!Array.isArray(watchlists) || watchlists.length >= MAX_MARKET_WATCHLISTS) {
        return Array.isArray(watchlists) ? watchlists : [];
    }

    const targetTemplateNameSet = new Set(
        (Array.isArray(missingTemplateNames) ? missingTemplateNames : [])
            .map((name) => String(name || '').trim().toLowerCase())
            .filter(Boolean)
    );
    if (targetTemplateNameSet.size === 0) {
        return watchlists;
    }

    const templateWatchlists = await buildPreloadedTemplateWatchlists(templates, targetTemplateNameSet);
    if (templateWatchlists.length === 0) return watchlists;

    const templateByName = new Map(
        templateWatchlists.map((item) => [String(item.name || '').trim().toLowerCase(), item])
    );
    const usedNameMap = createUsedWatchlistNameMap(watchlists);
    const currentNameSet = new Set(
        watchlists.map((item) => normalizeMarketWatchlistName(item?.name).toLowerCase())
    );
    const nextWatchlists = [...watchlists];

    for (const template of templates) {
        if (nextWatchlists.length >= MAX_MARKET_WATCHLISTS) break;

        const templateNameKey = String(template.name || '').trim().toLowerCase();
        if (!targetTemplateNameSet.has(templateNameKey)) continue;
        if (currentNameSet.has(templateNameKey)) continue;

        const templateEntry = templateByName.get(templateNameKey);
        if (!templateEntry) continue;

        const now = new Date();
        nextWatchlists.push({
            id: createMarketWatchlistId(),
            name: makeUniqueWatchlistName(template.name, usedNameMap),
            symbols: templateEntry.symbols,
            customSymbols: [],
            templateKey: String(templateEntry.key || template.key || '').trim().toLowerCase() || undefined,
            isDefault: false,
            createdAt: now,
            updatedAt: now,
        });
        currentNameSet.add(templateNameKey);
    }

    return nextWatchlists;
};

const buildTemplateLookup = async (templates = []) => {
    const preloaded = await buildPreloadedTemplateWatchlists(templates);
    const symbolMap = new Map();
    const keyByName = new Map();

    for (const entry of preloaded) {
        const nameKey = normalizeMarketWatchlistName(entry?.name).toLowerCase();
        const templateKey = String(entry?.key || '').trim().toLowerCase();
        const symbols = normalizeSelectedSymbols(entry?.symbols);

        if (templateKey) {
            symbolMap.set(templateKey, symbols);
        }
        if (nameKey) {
            symbolMap.set(nameKey, symbols);
            if (templateKey) {
                keyByName.set(nameKey, templateKey);
            }
        }
    }

    return { symbolMap, keyByName };
};

const mergeTemplateWatchlistSymbols = (watchlist, baseSymbols = []) => {
    const baseList = normalizeSelectedSymbols(baseSymbols);
    const baseSet = new Set(baseList);
    const storedSymbols = normalizeSelectedSymbols(watchlist?.symbols);
    const hasCustomField = watchlist && Object.prototype.hasOwnProperty.call(watchlist, 'customSymbols');
    const storedCustomRaw = hasCustomField ? watchlist?.customSymbols : null;
    const storedCustom = Array.isArray(storedCustomRaw)
        ? normalizeSelectedSymbols(storedCustomRaw)
        : [];

    if (!hasCustomField || storedCustomRaw === null) {
        return {
            symbols: baseList,
            customSymbols: [],
        };
    }

    const customSymbols = storedCustom.length > 0
        ? storedCustom.filter((sym) => !baseSet.has(sym))
        : storedSymbols.filter((sym) => !baseSet.has(sym));

    const allowedSet = new Set([...baseList, ...customSymbols]);
    const ordered = [];
    const seen = new Set();

    for (const sym of storedSymbols) {
        if (!allowedSet.has(sym) || seen.has(sym)) continue;
        ordered.push(sym);
        seen.add(sym);
    }

    for (const sym of baseList) {
        if (seen.has(sym)) continue;
        ordered.push(sym);
        seen.add(sym);
    }

    for (const sym of customSymbols) {
        if (seen.has(sym)) continue;
        ordered.push(sym);
        seen.add(sym);
    }

    return {
        symbols: ordered,
        customSymbols,
    };
};

const resolveTemplateSymbolsForWatchlist = (watchlist, templateSymbolMap, templateKeyByName) => {
    const nameKey = normalizeMarketWatchlistName(watchlist?.name).toLowerCase();
    const directKey = String(watchlist?.templateKey || '').trim().toLowerCase();
    const resolvedKey = directKey || (templateKeyByName?.get(nameKey) ?? '');
    const symbols =
        (resolvedKey && templateSymbolMap?.get(resolvedKey)) ||
        templateSymbolMap?.get(nameKey) ||
        [];
    return { symbols, templateKey: resolvedKey || directKey || undefined };
};

const upsertAllWatchlist = (watchlists = []) => {
    const list = Array.isArray(watchlists) ? watchlists : [];
    if (list.length === 0) return list;

    const normalizedAllName = SYSTEM_ALL_WATCHLIST_NAME.toLowerCase();
    const existingIndex = list.findIndex(
        (item) => normalizeMarketWatchlistName(item?.name).toLowerCase() === normalizedAllName
    );

    const symbolSet = new Set();
    list.forEach((item) => {
        if (!item || normalizeMarketWatchlistName(item.name).toLowerCase() === normalizedAllName) return;
        normalizeSelectedSymbols(item.symbols).forEach((sym) => symbolSet.add(sym));
    });

    const mergedSymbols = Array.from(symbolSet);
    if (mergedSymbols.length === 0) return list;

    const now = new Date();
    const allEntry = existingIndex >= 0
        ? {
            ...list[existingIndex],
            name: SYSTEM_ALL_WATCHLIST_NAME,
            symbols: mergedSymbols,
            updatedAt: now,
        }
        : {
            id: createMarketWatchlistId(),
            name: SYSTEM_ALL_WATCHLIST_NAME,
            symbols: mergedSymbols,
            isDefault: true,
            createdAt: now,
            updatedAt: now,
        };

    const withoutAll = list.filter(
        (item) => normalizeMarketWatchlistName(item?.name).toLowerCase() !== normalizedAllName
    );
    const next = [allEntry, ...withoutAll];

    if (!next.some((item) => item.isDefault)) {
        next[0].isDefault = true;
    }

    return next;
};

const pickWatchlistSnapshot = (watchlists = []) =>
    (Array.isArray(watchlists) ? watchlists : []).map((item) => ({
        id: String(item?.id || '').trim(),
        name: normalizeMarketWatchlistName(item?.name),
        symbols: normalizeSelectedSymbols(item?.symbols),
        customSymbols: normalizeSelectedSymbols(item?.customSymbols),
        templateKey: String(item?.templateKey || '').trim().toLowerCase() || undefined,
        isDefault: Boolean(item?.isDefault),
    }));

const formatUserWatchlistSummary = (watchlist, activeWatchlistId) => ({
    id: watchlist.id,
    name: watchlist.name,
    isDefault: Boolean(watchlist.isDefault),
    isActive: watchlist.id === activeWatchlistId,
    symbolCount: Array.isArray(watchlist.symbols) ? watchlist.symbols.length : 0,
    symbols: normalizeSelectedSymbols(watchlist.symbols),
    createdAt: watchlist.createdAt,
    updatedAt: watchlist.updatedAt,
});

const normalizeAndLimitWatchlistSymbols = (symbols = [], symbolDocsBySymbol = new Map()) => {
    const normalizedSymbols = normalizeSelectedSymbols(symbols);
    if (normalizedSymbols.length === 0) {
        return {
            normalizedSymbols,
            enforcedSymbols: [],
        };
    }

    return {
        normalizedSymbols,
        enforcedSymbols: limitSelectedSymbolsPerSegment(
            normalizedSymbols,
            symbolDocsBySymbol,
            MAX_SELECTED_SYMBOLS_PER_SEGMENT
        ),
    };
};

const resolveUserMarketWatchlistsState = async (user) => {
    const fallbackSymbols = normalizeSelectedSymbols(user?.marketWatchlist);
    const storedWatchlists = Array.isArray(user?.marketWatchlists) ? user.marketWatchlists : [];
    let initialWatchlists = buildInitialMarketWatchlists(storedWatchlists, fallbackSymbols);
    const forcedActiveWatchlistId = String(user?.activeMarketWatchlistId || '').trim();

    const activeTemplates = await getActiveMarketWatchlistTemplates();
    const { symbolMap: templateSymbolMap, keyByName: templateKeyByName } =
        await buildTemplateLookup(activeTemplates);
    const templateNames = activeTemplates.map((template) =>
        normalizeMarketWatchlistName(template?.name).toLowerCase()
    );
    const existingNames = new Set(
        initialWatchlists.map((item) =>
            normalizeMarketWatchlistName(item?.name).toLowerCase()
        )
    );
    const missingTemplateNames = templateNames.filter((name) => !existingNames.has(name));

    initialWatchlists = await appendMissingPreloadedWatchlists(
        initialWatchlists,
        activeTemplates,
        missingTemplateNames
    );
    initialWatchlists = upsertAllWatchlist(initialWatchlists);

    initialWatchlists = initialWatchlists.map((item) => {
        const nameKey = normalizeMarketWatchlistName(item?.name).toLowerCase();
        let templateKey = String(item?.templateKey || '').trim().toLowerCase();
        if (!templateKey) {
            templateKey = templateKeyByName.get(nameKey) || '';
        }
        const baseSymbols =
            (templateKey && templateSymbolMap.get(templateKey)) ||
            templateSymbolMap.get(nameKey);
        if (!baseSymbols) return item;

        const merged = mergeTemplateWatchlistSymbols(item, baseSymbols);
        const symbolsChanged =
            !isSameSymbolOrder(normalizeSelectedSymbols(item.symbols), merged.symbols) ||
            !isSameSymbolOrder(normalizeSelectedSymbols(item.customSymbols), merged.customSymbols);

        return {
            ...item,
            symbols: merged.symbols,
            customSymbols: merged.customSymbols,
            templateKey: templateKey || item.templateKey,
            updatedAt: symbolsChanged ? new Date() : item.updatedAt,
        };
    });

    const allSymbols = normalizeSelectedSymbols(initialWatchlists.flatMap((item) => item.symbols));
    const symbolDocs = allSymbols.length
        ? await MasterSymbol.find({ symbol: { $in: allSymbols } })
            .select('symbol segment exchange')
            .lean()
        : [];
    const symbolDocsBySymbol = buildSelectedSymbolDocsMap(symbolDocs);

    let watchlists = initialWatchlists.map((item) => {
        const { normalizedSymbols, enforcedSymbols } = normalizeAndLimitWatchlistSymbols(
            item.symbols,
            symbolDocsBySymbol
        );
        const finalSymbols = isSystemAllWatchlistName(item?.name)
            ? normalizedSymbols
            : enforcedSymbols;
        const symbolsChanged = !isSameSymbolOrder(normalizedSymbols, finalSymbols);
        return {
            ...item,
            symbols: finalSymbols,
            updatedAt: symbolsChanged ? new Date() : item.updatedAt,
        };
    });

    let defaultIndex = watchlists.findIndex((item) => item.isDefault);
    if (defaultIndex === -1) {
        defaultIndex = 0;
    }
    watchlists = watchlists.map((item, index) => ({
        ...item,
        isDefault: index === defaultIndex,
    }));

    let activeWatchlistId = forcedActiveWatchlistId || String(user?.activeMarketWatchlistId || '').trim();
    let activeWatchlist = watchlists.find((item) => item.id === activeWatchlistId) || null;
    if (!activeWatchlist) {
        activeWatchlist = watchlists[defaultIndex] || watchlists[0];
        activeWatchlistId = activeWatchlist?.id || '';
    }

    const currentSnapshot = pickWatchlistSnapshot(user?.marketWatchlists);
    const nextSnapshot = pickWatchlistSnapshot(watchlists);
    const watchlistsChanged =
        JSON.stringify(currentSnapshot) !== JSON.stringify(nextSnapshot);
    const activeWatchlistChanged =
        String(user?.activeMarketWatchlistId || '').trim() !== activeWatchlistId;
    const activeSymbols = normalizeSelectedSymbols(activeWatchlist?.symbols);
    const legacyWatchlistChanged = !isSameSymbolOrder(
        normalizeSelectedSymbols(user?.marketWatchlist),
        activeSymbols
    );

    return {
        watchlists,
        activeWatchlistId,
        activeWatchlist,
        shouldPersist: watchlistsChanged || activeWatchlistChanged || legacyWatchlistChanged,
        templateSymbolMap,
        templateKeyByName,
    };
};

const commitUserMarketWatchlistsState = (user, watchlists = [], activeWatchlistId = '') => {
    const targetWatchlists = Array.isArray(watchlists) ? watchlists : [];
    const activeWatchlist =
        targetWatchlists.find((item) => item.id === activeWatchlistId) ||
        targetWatchlists.find((item) => item.isDefault) ||
        targetWatchlists[0] ||
        null;
    const resolvedActiveWatchlistId = activeWatchlist?.id || '';
    const activeSymbols = normalizeSelectedSymbols(activeWatchlist?.symbols);

    user.marketWatchlists = targetWatchlists;
    user.activeMarketWatchlistId = resolvedActiveWatchlistId;
    user.marketWatchlist = activeSymbols;

    return {
        activeWatchlist,
        activeWatchlistId: resolvedActiveWatchlistId,
    };
};

const validateWatchlistName = (value) => {
    const name = normalizeMarketWatchlistName(value);
    if (!name) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Watchlist name is required');
    }
    if (isSystemAllWatchlistName(name)) {
        throw new ApiError(httpStatus.BAD_REQUEST, '"All" is reserved for the system watchlist');
    }
    if (isTemplateWatchlistName(name)) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'This watchlist name is reserved');
    }
    if (name.length < MIN_MARKET_WATCHLIST_NAME_LENGTH) {
        throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Watchlist name must be at least ${MIN_MARKET_WATCHLIST_NAME_LENGTH} characters`
        );
    }
    if (name.length > MAX_MARKET_WATCHLIST_NAME_LENGTH) {
        throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Watchlist name cannot exceed ${MAX_MARKET_WATCHLIST_NAME_LENGTH} characters`
        );
    }
    return name;
};

const assertMutableWatchlist = (watchlist) => {
    if (!watchlist) return;
    if (isSystemAllWatchlistName(watchlist.name)) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'The "All" watchlist is read-only');
    }
};

const isReservedTemplateName = async (name = '') => {
    const normalized = normalizeMarketWatchlistName(name).toLowerCase();
    if (!normalized) return false;
    const templates = await getActiveMarketWatchlistTemplates();
    return templates.some(
        (template) => normalizeMarketWatchlistName(template?.name).toLowerCase() === normalized
    );
};

const hasDuplicateWatchlistName = (watchlists = [], name = '', ignoreId = '') => {
    const normalizedName = normalizeMarketWatchlistName(name).toLowerCase();
    return watchlists.some((item) => (
        item.id !== ignoreId && normalizeMarketWatchlistName(item.name).toLowerCase() === normalizedName
    ));
};

const getUserWatchlists = catchAsync(async (req, res) => {
    const user = req.user;
    const { watchlists, activeWatchlistId, shouldPersist } = await resolveUserMarketWatchlistsState(user);

    if (shouldPersist) {
        commitUserMarketWatchlistsState(user, watchlists, activeWatchlistId);
        await user.save();
    }

    res.send({
        activeWatchlistId,
        watchlists: watchlists.map((item) => formatUserWatchlistSummary(item, activeWatchlistId)),
    });
});

const createUserWatchlist = catchAsync(async (req, res) => {
    const user = req.user;
    const name = validateWatchlistName(req.body?.name);
    if (await isReservedTemplateName(name)) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'This watchlist name is reserved');
    }
    const setActive = req.body?.setActive !== false;

    const { watchlists, activeWatchlistId, templateSymbolMap } =
        await resolveUserMarketWatchlistsState(user);
    if (watchlists.length >= MAX_MARKET_WATCHLISTS) {
        throw new ApiError(
            httpStatus.BAD_REQUEST,
            `You can create up to ${MAX_MARKET_WATCHLISTS} watchlists`
        );
    }
    if (hasDuplicateWatchlistName(watchlists, name)) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Watchlist name already exists');
    }

    const now = new Date();
    const watchlist = {
        id: createMarketWatchlistId(),
        name,
        symbols: [],
        customSymbols: [],
        templateKey: undefined,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
    };
    const nextWatchlists = [...watchlists, watchlist];
    const nextActiveWatchlistId = setActive ? watchlist.id : activeWatchlistId;
    commitUserMarketWatchlistsState(user, nextWatchlists, nextActiveWatchlistId);
    await user.save();

    res.status(httpStatus.CREATED).send({
        message: 'Watchlist created',
        watchlist: formatUserWatchlistSummary(watchlist, user.activeMarketWatchlistId),
        activeWatchlistId: user.activeMarketWatchlistId,
        watchlists: nextWatchlists.map((item) =>
            formatUserWatchlistSummary(item, user.activeMarketWatchlistId)
        ),
    });
});

const updateUserWatchlist = catchAsync(async (req, res) => {
    const user = req.user;
    const watchlistId = String(req.params.id || '').trim();
    if (!watchlistId) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Watchlist id is required');
    }

    const setActive = req.body?.setActive === true;
    const hasName = typeof req.body?.name === 'string';
    if (!setActive && !hasName) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Nothing to update');
    }

    const { watchlists, activeWatchlistId } = await resolveUserMarketWatchlistsState(user);
    const index = watchlists.findIndex((item) => item.id === watchlistId);
    if (index === -1) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Watchlist not found');
    }

    const nextWatchlists = [...watchlists];
    const currentWatchlist = nextWatchlists[index];
    assertMutableWatchlist(currentWatchlist);
    let updatedWatchlist = { ...currentWatchlist };

    if (hasName) {
        if (await isReservedTemplateName(currentWatchlist.name)) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Default folders cannot be renamed');
        }
        const name = validateWatchlistName(req.body.name);
        if (await isReservedTemplateName(name)) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'This watchlist name is reserved');
        }
        if (hasDuplicateWatchlistName(nextWatchlists, name, watchlistId)) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Watchlist name already exists');
        }
        if (name !== currentWatchlist.name) {
            updatedWatchlist = {
                ...updatedWatchlist,
                name,
                updatedAt: new Date(),
            };
        }
    }

    nextWatchlists[index] = updatedWatchlist;
    const nextActiveWatchlistId = setActive ? watchlistId : activeWatchlistId;
    commitUserMarketWatchlistsState(user, nextWatchlists, nextActiveWatchlistId);
    await user.save();

    res.send({
        message: 'Watchlist updated',
        watchlist: formatUserWatchlistSummary(updatedWatchlist, user.activeMarketWatchlistId),
        activeWatchlistId: user.activeMarketWatchlistId,
        watchlists: nextWatchlists.map((item) =>
            formatUserWatchlistSummary(item, user.activeMarketWatchlistId)
        ),
    });
});

const deleteUserWatchlist = catchAsync(async (req, res) => {
    const user = req.user;
    const watchlistId = String(req.params.id || '').trim();
    if (!watchlistId) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Watchlist id is required');
    }

    const { watchlists, activeWatchlistId } = await resolveUserMarketWatchlistsState(user);
    const index = watchlists.findIndex((item) => item.id === watchlistId);
    if (index === -1) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Watchlist not found');
    }
    assertMutableWatchlist(watchlists[index]);

    const nextWatchlists = watchlists.filter((item) => item.id !== watchlistId);
    if (!nextWatchlists.some((item) => item.isDefault) && nextWatchlists.length > 0) {
        nextWatchlists[0] = { ...nextWatchlists[0], isDefault: true };
    }

    let nextActiveWatchlistId = activeWatchlistId;
    if (!nextWatchlists.some((item) => item.id === nextActiveWatchlistId)) {
        const defaultWatchlist = nextWatchlists.find((item) => item.isDefault) || nextWatchlists[0];
        nextActiveWatchlistId = defaultWatchlist?.id || '';
    }

    commitUserMarketWatchlistsState(user, nextWatchlists, nextActiveWatchlistId);
    await user.save();

    res.send({
        message: 'Watchlist deleted',
        activeWatchlistId: user.activeMarketWatchlistId,
        watchlists: nextWatchlists.map((item) =>
            formatUserWatchlistSummary(item, user.activeMarketWatchlistId)
        ),
    });
});

// Get Subscription-Based Tickers (Watchlist)
const getTickers = catchAsync(async (req, res) => {
    // Default to Restricted/Empty if no user (or return Nifty 50 as safe default)
    let allowedSegments = ['INDICES']; 
    let allowedExchanges = ['NSE']; // Minimal default

    if (req.user) {
        try {
            const { default: authService } = await import('../services/auth.service.js');
            const planData = await authService.getUserActivePlan(req.user);

            if (planData && planData.permissions.length > 0) {
                 const perms = planData.permissions;
                 allowedSegments = []; 
                 allowedExchanges = [];

                 if (perms.includes('COMMODITY') || perms.includes('MCX_FUT')) {
                    allowedSegments.push('COMMODITY', 'COMEX');
                    allowedExchanges.push('MCX', 'COMEX');
                 }
                 if (perms.includes('EQUITY_INTRA') || perms.includes('EQUITY_DELIVERY')) {
                    allowedSegments.push('EQUITY', 'INDICES');
                    allowedExchanges.push('NSE');
                 }
                 if (perms.includes('NIFTY_OPT') || perms.includes('BANKNIFTY_OPT')) {
                    allowedSegments.push('FNO', 'INDICES');
                    allowedExchanges.push('NFO', 'MCX', 'CDS');
                 }
                 if (perms.includes('CURRENCY')) {
                    allowedSegments.push('CURRENCY', 'FOREX');
                    allowedExchanges.push('CDS', 'BCD');
                 }
                 if (perms.includes('CRYPTO')) {
                    allowedSegments.push('CRYPTO');
                    allowedExchanges.push('CRYPTO');
                 }
            }
        } catch (e) {
            logger.error(`Error in getTickers filter: ${e.message}`);
        }
    }

    // Filter allowed symbols
    const query = { 
        isWatchlist: true,
        $or: [
            { segment: { $in: allowedSegments } },
            { exchange: { $in: allowedExchanges } }
        ]
    };

    // If no allowed segments found (e.g. invalid user), query fails safe (empty OR default Nifty)
    if (allowedSegments.length === 0 && allowedExchanges.length === 0) {
        // Fallback: Show Nifty 50 only
        query.$or = [{ symbol: 'NSE:NIFTY 50-INDEX' }];
    }

    const symbols = await MasterSymbol.find(query).sort({ segment: 1, symbol: 1 }).lean();

    // Inject Real-Time Prices
    const enriched = enrichMarketSymbols(symbols);

    res.send(enriched);
});

// Get User Market Watchlist (Symbols)
const getUserWatchlist = catchAsync(async (req, res) => {
    const user = req.user;
    const requestedWatchlistId = String(req.query?.watchlistId || '').trim();
    const { watchlists, activeWatchlist, activeWatchlistId, shouldPersist, templateSymbolMap, templateKeyByName } =
        await resolveUserMarketWatchlistsState(user);

    const targetWatchlist = requestedWatchlistId
        ? watchlists.find((item) => item.id === requestedWatchlistId) || null
        : activeWatchlist;
    if (!targetWatchlist) {
        if (!requestedWatchlistId && watchlists.length === 0) {
            return res.send([]);
        }
        throw new ApiError(httpStatus.NOT_FOUND, 'Watchlist not found');
    }

    const symbols = normalizeSelectedSymbols(targetWatchlist.symbols);
    if (symbols.length === 0) {
        return res.send([]);
    }

    const { symbols: lockedSymbols, templateKey } = resolveTemplateSymbolsForWatchlist(
        targetWatchlist,
        templateSymbolMap,
        templateKeyByName
    );
    const lockedSet = new Set(lockedSymbols);

    const docs = await MasterSymbol.find({
        symbol: {
            $in: Array.from(new Set(symbols.flatMap((symbol) => getMarketAliasLookupSymbols(symbol))))
        }
    }).lean();
    const map = buildSymbolDocMap(docs);

    const ordered = symbols
        .map((sym) => {
            const doc = resolveAliasBackedSymbolDoc(sym, map);
            if (doc) {
                return { ...doc, isLocked: lockedSet.has(sym) };
            }
            return { symbol: sym, name: sym, isLocked: lockedSet.has(sym) };
        })
        .filter((item) => {
            const isUnsupported =
                item?.isActive === false &&
                item?.meta?.liveFeedSupported === false &&
                !(item?.lastPrice > 0) &&
                !(item?.prevClose > 0);
            return !isUnsupported;
        });

    await Promise.all(ordered.map(s => marketDataService.ensureSymbolSubscription(s.symbol, s)));

    const needsQuote = ordered.some(s => {
        const live = marketDataService.getBestLivePrice(s.symbol, s, 0);
        const hasFallback = (s.lastPrice && s.lastPrice > 0) || (s.prevClose && s.prevClose > 0);
        const hasLive = Number.isFinite(Number(live)) && Number(live) > 0;
        return !hasLive && !hasFallback;
    });

    if (needsQuote) {
        await marketDataService.fetchQuoteBySymbols(ordered.map(s => s.symbol));
    }

    const enriched = enrichMarketSymbols(ordered).filter((item) => {
        if (isUnsupportedWatchlistSymbol(item.symbol)) {
            return false;
        }

        const hasResolvedMetadata =
            map.has(normalizeUpper(item.symbol)) ||
            Boolean(getMarketSymbolAliasDefinition(item.symbol));
        const hasPriceData = [
            item.price,
            item.prevClose,
            item.open,
            item.high,
            item.low,
            item.bid,
            item.ask,
        ].some((value) => Number(value) > 0);

        return hasResolvedMetadata || hasPriceData;
    });

    const cleanedSymbols = enriched.map((item) => item.symbol);
    const watchlistSymbolsChanged = !isSameSymbolOrder(cleanedSymbols, symbols);

    if (shouldPersist || watchlistSymbolsChanged) {
        if (watchlistSymbolsChanged) {
            targetWatchlist.symbols = cleanedSymbols;
            if (Array.isArray(targetWatchlist.customSymbols)) {
                const cleanedSet = new Set(cleanedSymbols);
                targetWatchlist.customSymbols = normalizeSelectedSymbols(targetWatchlist.customSymbols)
                    .filter((symbol) => cleanedSet.has(symbol));
            }
            targetWatchlist.updatedAt = new Date();
        }

        commitUserMarketWatchlistsState(user, watchlists, activeWatchlistId);
        await user.save();
    }

    res.send(enriched);
});

const addUserWatchlist = catchAsync(async (req, res) => {
    const { symbol } = req.body;
    if (!symbol) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Symbol is required');
    }
    const requestedWatchlistId = String(req.body?.watchlistId || '').trim();

    let normalized = String(symbol).trim().toUpperCase();
    normalized = await resolvePreferredCryptoSpotSymbol(normalized);
    const symbolDoc = await findSymbolDocBySymbolOrAlias(normalized);
    if (!symbolDoc) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Symbol not found');
    }

    const user = req.user;
    const { watchlists, activeWatchlistId, templateSymbolMap, templateKeyByName } =
        await resolveUserMarketWatchlistsState(user);
    const targetWatchlistId = requestedWatchlistId || activeWatchlistId;
    const targetIndex = watchlists.findIndex((item) => item.id === targetWatchlistId);
    if (targetIndex === -1) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Watchlist not found');
    }

    const targetWatchlist = { ...watchlists[targetIndex] };
    assertMutableWatchlist(targetWatchlist);
    const list = [...normalizeSelectedSymbols(targetWatchlist.symbols)];
    if (!list.includes(normalized)) {
        const segmentKey = getSelectionBucketKey(symbolDoc);
        let existingSymbolsInSegment = 0;

        if (list.length > 0) {
            const existingDocs = await MasterSymbol.find({ symbol: { $in: list } })
                .select('symbol segment exchange')
                .lean();
            existingSymbolsInSegment = existingDocs.reduce((count, doc) => (
                getSelectionBucketKey(doc) === segmentKey ? count + 1 : count
            ), 0);
        }

        if (existingSymbolsInSegment >= MAX_SELECTED_SYMBOLS_PER_SEGMENT) {
            throw new ApiError(
                httpStatus.BAD_REQUEST,
                `You can add only ${MAX_SELECTED_SYMBOLS_PER_SEGMENT} scripts in the ${segmentKey} segment. Signals for selected scripts are not limited.`
            );
        }

        list.push(normalized);
    }

    const { symbols: baseSymbols, templateKey } = resolveTemplateSymbolsForWatchlist(
        targetWatchlist,
        templateSymbolMap,
        templateKeyByName
    );

    if (baseSymbols.length > 0) {
        const merged = mergeTemplateWatchlistSymbols(
            { ...targetWatchlist, symbols: list },
            baseSymbols
        );
        targetWatchlist.symbols = merged.symbols;
        targetWatchlist.customSymbols = merged.customSymbols;
        if (templateKey && !targetWatchlist.templateKey) {
            targetWatchlist.templateKey = templateKey;
        }
    } else {
        targetWatchlist.symbols = list;
        targetWatchlist.customSymbols = normalizeSelectedSymbols(targetWatchlist.customSymbols);
    }
    targetWatchlist.updatedAt = new Date();
    watchlists[targetIndex] = targetWatchlist;
    commitUserMarketWatchlistsState(user, watchlists, activeWatchlistId);
    await user.save();

    // Ensure symbol is subscribed and initial quote fetched (Kite authenticated)
    await marketDataService.addSymbol(symbolDoc);

    res.send({
        symbols: targetWatchlist.symbols,
        watchlistId: targetWatchlist.id,
        activeWatchlistId: user.activeMarketWatchlistId,
    });
});

const removeUserWatchlist = catchAsync(async (req, res) => {
    const { symbol } = req.body;
    if (!symbol) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Symbol is required');
    }
    const requestedWatchlistId = String(req.body?.watchlistId || '').trim();

    let normalized = String(symbol).trim().toUpperCase();
    normalized = await resolvePreferredCryptoSpotSymbol(normalized);
    const symbolDoc = await MasterSymbol.findOne({ symbol: normalized }).select('symbol');
    const user = req.user;
    const { watchlists, activeWatchlistId, templateSymbolMap, templateKeyByName } =
        await resolveUserMarketWatchlistsState(user);
    const targetWatchlistId = requestedWatchlistId || activeWatchlistId;
    const targetIndex = watchlists.findIndex((item) => item.id === targetWatchlistId);
    if (targetIndex === -1) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Watchlist not found');
    }
    const targetWatchlist = { ...watchlists[targetIndex] };
    assertMutableWatchlist(targetWatchlist);
    const { symbols: baseSymbols, templateKey } = resolveTemplateSymbolsForWatchlist(
        targetWatchlist,
        templateSymbolMap,
        templateKeyByName
    );
    if (baseSymbols.includes(normalized)) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Default watchlist symbols cannot be removed');
    }

    const list = normalizeSelectedSymbols(targetWatchlist.symbols);
    const next = list.filter((s) => s !== normalized);

    if (baseSymbols.length > 0) {
        const merged = mergeTemplateWatchlistSymbols(
            { ...targetWatchlist, symbols: next },
            baseSymbols
        );
        targetWatchlist.symbols = merged.symbols;
        targetWatchlist.customSymbols = merged.customSymbols;
        if (templateKey && !targetWatchlist.templateKey) {
            targetWatchlist.templateKey = templateKey;
        }
    } else {
        targetWatchlist.symbols = next;
        targetWatchlist.customSymbols = normalizeSelectedSymbols(targetWatchlist.customSymbols);
    }
    targetWatchlist.updatedAt = new Date();
    watchlists[targetIndex] = targetWatchlist;
    commitUserMarketWatchlistsState(user, watchlists, activeWatchlistId);
    await user.save();

    if (symbolDoc?.symbol) {
        marketDataService.unsubscribeSymbol(symbolDoc.symbol);
    }

    res.send({
        symbols: targetWatchlist.symbols,
        watchlistId: targetWatchlist.id,
        activeWatchlistId: user.activeMarketWatchlistId,
    });
});

const reorderUserWatchlist = catchAsync(async (req, res) => {
    const requestedSymbols = Array.isArray(req.body?.symbols)
        ? normalizeSelectedSymbols(req.body.symbols)
        : [];
    const requestedWatchlistId = String(req.body?.watchlistId || '').trim();

    const user = req.user;
    const { watchlists, activeWatchlistId, templateSymbolMap, templateKeyByName } =
        await resolveUserMarketWatchlistsState(user);
    const targetWatchlistId = requestedWatchlistId || activeWatchlistId;
    const targetIndex = watchlists.findIndex((item) => item.id === targetWatchlistId);
    if (targetIndex === -1) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Watchlist not found');
    }
    const targetWatchlist = { ...watchlists[targetIndex] };
    const currentSymbols = normalizeSelectedSymbols(targetWatchlist.symbols);

    if (currentSymbols.length === 0) {
        targetWatchlist.symbols = [];
        targetWatchlist.updatedAt = new Date();
        watchlists[targetIndex] = targetWatchlist;
        commitUserMarketWatchlistsState(user, watchlists, activeWatchlistId);
        await user.save();
        return res.send({
            symbols: [],
            watchlistId: targetWatchlist.id,
            activeWatchlistId: user.activeMarketWatchlistId,
        });
    }

    if (requestedSymbols.length === 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Symbols array is required');
    }

    const allowedSymbols = new Set(currentSymbols);
    const nextSymbols = requestedSymbols.filter((symbol, index, list) => (
        allowedSymbols.has(symbol) && list.indexOf(symbol) === index
    ));
    const missingSymbols = currentSymbols.filter((symbol) => !nextSymbols.includes(symbol));
    const finalOrder = [...nextSymbols, ...missingSymbols];

    const { symbols: baseSymbols, templateKey } = resolveTemplateSymbolsForWatchlist(
        targetWatchlist,
        templateSymbolMap,
        templateKeyByName
    );
    if (baseSymbols.length > 0) {
        const merged = mergeTemplateWatchlistSymbols(
            { ...targetWatchlist, symbols: finalOrder },
            baseSymbols
        );
        targetWatchlist.symbols = merged.symbols;
        targetWatchlist.customSymbols = merged.customSymbols;
        if (templateKey && !targetWatchlist.templateKey) {
            targetWatchlist.templateKey = templateKey;
        }
    } else {
        targetWatchlist.symbols = finalOrder;
        targetWatchlist.customSymbols = normalizeSelectedSymbols(targetWatchlist.customSymbols);
    }
    targetWatchlist.updatedAt = new Date();
    watchlists[targetIndex] = targetWatchlist;
    commitUserMarketWatchlistsState(user, watchlists, activeWatchlistId);
    await user.save();

    res.send({
        symbols: targetWatchlist.symbols,
        watchlistId: targetWatchlist.id,
        activeWatchlistId: user.activeMarketWatchlistId,
    });
});

import { calculateRSI, getFearGreedFromRSI } from '../utils/technicalIndicators.js'; // Import Utility

// Get Market Sentiment (Real-Time RSI + VIX)
const getSentiment = catchAsync(async (req, res) => {
    let context = "INDIAN"; // Default
    let symbol = "NSE:NIFTY 50-INDEX"; 
    let marketLabel = "Market Mood";
    let secondarySymbol = "NSE:NIFTY BANK-INDEX";
    let secondaryName = "BankNifty";

    // Determine User Context
    if (req.user) {
        try {
            const { default: authService } = await import('../services/auth.service.js');
            const planData = await authService.getUserActivePlan(req.user);
            
            if (planData && planData.permissions.length > 0) {
                const perms = planData.permissions;
                
                // Segment Priority Logic
                if (perms.includes('CRYPTO')) {
                    context = "CRYPTO";
                    symbol = "BTCUSDT"; // AllTick/Global
                    marketLabel = "Crypto Mood";
                    secondarySymbol = "ETHUSDT";
                    secondaryName = "ETH";
                } else if (perms.includes('COMMODITY') || perms.includes('MCX_FUT')) {
                    // Check if strictly Global Commodity or Indian MCX
                    // Usually users want Gold/Silver global sentiment
                    context = "COMMODITY";
                    symbol = "XAUUSD"; // Gold
                    marketLabel = "Gold Sentiment";
                    secondarySymbol = "XAGUSD";
                    secondaryName = "Silver";
                } else if (perms.includes('CURRENCY')) {
                    context = "FOREX";
                    symbol = "EURUSD";
                    marketLabel = "Forex Sentiment";
                    secondarySymbol = "GBPUSD";
                    secondaryName = "GBP/USD";
                } else {
                    // Default Indian Equity/FNO
                    context = "INDIAN";
                    symbol = "NSE:NIFTY 50-INDEX";
                    marketLabel = "Nifty Mood";
                    secondarySymbol = "NSE:NIFTY BANK-INDEX";
                    secondaryName = "BankNifty";
                }
            }
        } catch (err) {
            logger.error(`Error in getSentiment filter: ${err.message}`);
        }
    }

    // 2. Market Mood Calculation
    let rsiValue = null; 
    let fearGreedScore = 50; // Default Neutral
    let sentimentLabel = "Neutral";
    let sentimentTrend = "Neutral"; // Default
    let hasData = false;

    // A. Calculate RSI (Common for all)
    try {
        const to = Math.floor(Date.now() / 1000);
        const from = to - (60 * 24 * 60 * 60); // 60 Days
        const candles = await marketDataService.getHistory(symbol, 'day', from, to);
        let closes = (candles || []).map(c => c.close);
        
        // Append live price
        const currentPrice = marketDataService.currentPrices[symbol];
        if (currentPrice && currentPrice > 0) closes.push(currentPrice);

        if (closes.length > 14) {
            rsiValue = calculateRSI(closes, 14);
            hasData = true;
        }
    } catch (e) {
        logger.error(`Error calculating RSI for ${symbol}: ${e.message}`);
    }

    // B. Context Specific Adjustments
    if (context === "INDIAN") {
        // Indian Market: Use INDIA VIX if available
        const vixPrice = marketDataService.currentPrices['NSE:INDIA VIX'] || 
                         marketDataService.currentPrices['INDIA VIX'] || 0;
        
        // If we have RSI, start with that. If not, start with 50.
        fearGreedScore = rsiValue ?? 50; 

        // Adjust with VIX (Volatility Index)
        if (vixPrice > 0) {
            let vixImpact = 0;
            if (vixPrice > 22) vixImpact = -20; // High Fear
            else if (vixPrice > 16) vixImpact = -10; // Moderate Fear
            else if (vixPrice < 12) vixImpact = +10; // Greed/Confidence
            
            fearGreedScore += vixImpact;
            hasData = true; // We have at least VIX data
        }

        // Clamp
        fearGreedScore = Math.max(0, Math.min(100, fearGreedScore));

        // Generate Label
        if (!hasData) {
            sentimentLabel = "No Data";
            fearGreedScore = null;
        } else {
            if (fearGreedScore >= 80) sentimentLabel = "Extreme Greed";
            else if (fearGreedScore >= 60) sentimentLabel = "Greed";
            else if (fearGreedScore <= 20) sentimentLabel = "Extreme Fear";
            else if (fearGreedScore <= 40) sentimentLabel = "Fear";
            else sentimentLabel = "Neutral";
        }

        sentimentTrend = (fearGreedScore !== null && fearGreedScore >= 50) ? "Bullish" : "Bearish";

    } else {
        // Foreign (Crypto/Forex): Pure RSI based
        if (rsiValue !== null) {
            const rsiResult = getFearGreedFromRSI(rsiValue);
            fearGreedScore = rsiResult.score;
            sentimentLabel = rsiResult.label;
            sentimentTrend = (rsiValue > 50) ? "Bullish" : "Bearish";
        } else {
            sentimentLabel = "No Data";
            fearGreedScore = null;
        }
    }

    // 3. Market Trend Data (Percentage Change)
    const getTrend = (sym) => {
        const live = toNumber(marketDataService.getBestLivePrice(sym, null, 0), 0);
        const quote = marketDataService.getBestQuote(sym);
        const open = toNumber(quote?.ohlc?.open, live);
        
        if (live === 0 || open === 0) return { direction: null, change: null, hasData: false };
        
        const change = ((live - open) / open) * 100;
        return {
            direction: change >= 0 ? 'Bullish' : 'Bearish',
            change: parseFloat(change.toFixed(2)),
            hasData: true
        };
    };

    // Return context-aware trend
    // secondarySymbol and secondaryName are already set based on user context at the top
    // No need to re-declare them here.

    const sentiment = {
        fearGreed: {
            score: fearGreedScore !== null ? parseFloat(fearGreedScore.toFixed(0)) : null,
            label: sentimentLabel,
            trend: sentimentTrend,
            context: marketLabel,
            symbol: symbol
        },
        marketTrend: {
            primary: {
                name: symbol === "NSE:NIFTY 50-INDEX" ? "Nifty" : (symbol === "BTCUSDT" ? "BTC" : (symbol === "XAUUSD" ? "Gold" : symbol)),
                ...getTrend(symbol)
            },
            secondary: {
                name: secondaryName,
                ...getTrend(secondarySymbol)
            }
        }
    };
    
    res.send(sentiment);
});

// Get Hybrid Analysis for ANY Symbol
const getSymbolAnalysis = catchAsync(async (req, res) => {
    let { symbol } = req.params;
    if (!symbol) {
        throw new Error('Symbol is required');
    }
    symbol = symbol.toUpperCase();

    // 1. Fetch Candles Parallel (5m, 15m, 1H, 1D)
    // Use marketDataService.getHistory to handle Kite/AllTick automatically
    const now = Math.floor(Date.now() / 1000);
    const from = now - (5 * 24 * 60 * 60); // 5 Days back

    const [c5m, c15m, c1H, c1D] = await Promise.all([
        marketDataService.getHistory(symbol, '5', from.toString(), now.toString()),
        marketDataService.getHistory(symbol, '15', from.toString(), now.toString()),
        marketDataService.getHistory(symbol, '60', from.toString(), now.toString()),
        marketDataService.getHistory(symbol, 'D', from.toString(), now.toString()),
    ]);

    const analysis = {
        scan_5m: technicalAnalysisService.analyzeTimeframe(c5m, '5m'),
        scan_15m: technicalAnalysisService.analyzeTimeframe(c15m, '15m'),
        scan_1h: technicalAnalysisService.analyzeTimeframe(c1H, '1H'),
    };

    // 2. Calculate Daily Volatility Levels
    let volatility = {};
    if (c1D && c1D.length > 14) {
        // Calculate ATR 14
        let sumTR = 0;
        for(let i=c1D.length-14; i<c1D.length; i++) {
             const h = c1D[i].high; const l = c1D[i].low; const pc = c1D[i-1].close;
             sumTR += Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc));
        }
        const atr = sumTR / 14;
        const currentPrice = c1D[c1D.length-1].close;
        
        volatility = {
            atr: atr,
            expectedHigh: currentPrice + atr,
            expectedLow: currentPrice - atr,
            buyPrice: currentPrice + (atr * 0.2), 
            sellPrice: currentPrice - (atr * 0.2)
        };
    }

    res.send({
        symbol,
        analysis,
        volatility,
        timestamp: new Date()
    });
});

const getNews = catchAsync(async (req, res) => {
    let { symbol } = req.params;
    // Optional: Validate symbol or handle special cases?
    // FmpService handles formatting.
    const news = await fmpService.getNews(symbol);
    res.send(news);
});

const SEED_SEGMENTS = [
    { name: 'Equity Intraday', code: 'EQUITY' },
    { name: 'Indices', code: 'INDICES' },
    { name: 'Futures & Options', code: 'FNO' },
    { name: 'Commodity', code: 'COMMODITY' },
    { name: 'COMEX', code: 'COMEX' },
    { name: 'Currency', code: 'CURRENCY' },
    { name: 'BTST (Buy Today Sell Tomorrow)', code: 'BTST' }
];

const seedMarketData = catchAsync(async (req, res) => {
    // 1. Seed Segments
    const segCount = await MasterSegment.countDocuments();
    if (segCount === 0) {
        await MasterSegment.insertMany(SEED_SEGMENTS);
    }

    // 2. Seed Symbols (Upsert missing symbols only)
    if (SEED_SYMBOLS.length > 0) {
        for (const seed of SEED_SYMBOLS) {
            const doc = await MasterSymbol.findOneAndUpdate(
                { symbol: seed.symbol },
                { $setOnInsert: seed },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            if (!doc.symbolId) {
                doc.symbolId = buildMasterSymbolId(doc);
                await doc.save();
            }
        }

        await marketDataService.loadMasterSymbols({ forceReload: true });
        await marketDataService.refreshSymbolsCache({ bumpVersion: true });
    }

    res.status(httpStatus.CREATED).send({ message: 'Market Master Data Seeded Successfully' });
});

const createSegment = catchAsync(async (req, res) => {
    const { name, code } = req.body;
    const segment = await MasterSegment.create({ name, code });
    res.status(httpStatus.CREATED).send(segment);
});

const updateSegment = catchAsync(async (req, res) => {
    const { id } = req.params;
    const segment = await MasterSegment.findByIdAndUpdate(id, req.body, { new: true });
    res.send(segment);
});

import kiteInstrumentsService from '../services/kiteInstruments.service.js';

const createSymbol = catchAsync(async (req, res) => {
    normalizeSymbolPayload(req.body);
    await hydrateInstrumentToken(req.body);

    const symbol = new MasterSymbol(req.body);
    symbol.symbolId = buildMasterSymbolId(symbol);
    await symbol.save();
    
    // Real-time update: Add to running memory and subscribe
    await marketDataService.addSymbol(symbol);
    await marketDataService.refreshSymbolsCache({ bumpVersion: true });

    res.status(httpStatus.CREATED).send(enrichSymbol(symbol));
});

const updateSymbol = catchAsync(async (req, res) => {
    const { id } = req.params;
    const symbol = await MasterSymbol.findById(id);

    if (!symbol) {
        return res.status(httpStatus.NOT_FOUND).send({ message: 'Symbol not found' });
    }

    const previousSymbol = symbol.symbol;
    Object.assign(symbol, req.body);
    normalizeSymbolPayload(symbol);
    await hydrateInstrumentToken(symbol, previousSymbol);
    symbol.symbolId = buildMasterSymbolId(symbol);
    await symbol.save();

    if (previousSymbol && previousSymbol !== symbol.symbol) {
        marketDataService.unsubscribeSymbol(previousSymbol);
    }

    await marketDataService.addSymbol(symbol);
    await marketDataService.refreshSymbolsCache({ bumpVersion: true });

    res.send(enrichSymbol(symbol));
});

const generateSymbolId = catchAsync(async (req, res) => {
    const { id } = req.params;
    const symbol = await MasterSymbol.findById(id);

    if (!symbol) {
        return res.status(httpStatus.NOT_FOUND).send({ message: 'Symbol not found' });
    }

    symbol.symbolId = buildMasterSymbolId(symbol);
    await symbol.save();

    res.send(enrichSymbol(symbol));
});

const updateTradingViewStatus = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { tradingViewAdded } = req.body || {};

    if (typeof tradingViewAdded !== 'boolean') {
        throw new ApiError(httpStatus.BAD_REQUEST, 'tradingViewAdded must be a boolean');
    }

    const symbol = await MasterSymbol.findById(id);
    if (!symbol) {
        return res.status(httpStatus.NOT_FOUND).send({ message: 'Symbol not found' });
    }

    symbol.tradingViewAdded = tradingViewAdded;
    await symbol.save();

    res.send(enrichSymbol(symbol));
});

const getSegments = catchAsync(async (req, res) => {
    const segments = await MasterSegment.find(); // Return all, let frontend filter active if needed or admin sees all
    res.send(segments);
});

const getWatchlistTemplates = catchAsync(async (req, res) => {
    const includeInactive = String(req.query?.includeInactive || '').trim().toLowerCase() === 'true';
    const filter = includeInactive ? {} : { isActive: true };
    const templates = await MarketWatchlistTemplate.find(filter)
        .sort({ order: 1, createdAt: 1, _id: 1 })
        .lean();
    res.send(templates);
});

const createWatchlistTemplate = catchAsync(async (req, res) => {
    const payload = normalizeTemplatePayload(req.body);
    const existing = await MarketWatchlistTemplate.findOne({ key: payload.key });
    if (existing) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Template key already exists');
    }
    const created = await MarketWatchlistTemplate.create(payload);
    res.status(httpStatus.CREATED).send(created);
});

const updateWatchlistTemplate = catchAsync(async (req, res) => {
    const templateId = String(req.params.id || '').trim();
    if (!templateId) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Template id is required');
    }

    const existing = await MarketWatchlistTemplate.findById(templateId);
    if (!existing) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Template not found');
    }

    const payload = normalizeTemplatePayload({ ...existing.toObject(), ...req.body });

    if (payload.key !== existing.key) {
        const keyExists = await MarketWatchlistTemplate.findOne({ key: payload.key, _id: { $ne: existing._id } });
        if (keyExists) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Template key already exists');
        }
    }

    Object.assign(existing, payload);
    await existing.save();
    res.send(existing);
});

const deleteWatchlistTemplate = catchAsync(async (req, res) => {
    const templateId = String(req.params.id || '').trim();
    if (!templateId) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Template id is required');
    }
    const existing = await MarketWatchlistTemplate.findById(templateId);
    if (!existing) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Template not found');
    }
    await existing.deleteOne();
    res.status(httpStatus.NO_CONTENT).send();
});

const getSymbols = catchAsync(async (req, res) => {
    const requestedSegment = normalizeUpper(req.query.segment);
    const filter = buildSymbolFilter(req.query, { ignoreSegment: true });
    const paginated = String(req.query.paginated || '').trim().toLowerCase() === 'true';

    const applySegmentFilter = (docs = []) => {
        const filtered = docs
            .map(enrichSymbol)
            .filter((doc) => matchesSegmentGroup(doc, requestedSegment))
            .filter((doc) => (requestedSegment === 'FNO' ? isCurrentMonthContractDoc(doc) : true));

        return dedupeSymbols(filtered).sort((left, right) => {
            const activeDiff = Number(Boolean(right.isActive)) - Number(Boolean(left.isActive));
            if (activeDiff !== 0) return activeDiff;
            const segmentDiff = String(left.segmentGroup || left.segment || '').localeCompare(String(right.segmentGroup || right.segment || ''));
            if (segmentDiff !== 0) return segmentDiff;
            return String(left.symbol || '').localeCompare(String(right.symbol || ''));
        });
    };

    if (!paginated) {
        const symbols = await MasterSymbol.find(filter).lean();
        return res.send(applySegmentFilter(symbols));
    }

    const requestedPage = parseIntegerQuery(req.query.page, 1, 1, 100000);
    const limit = parseIntegerQuery(req.query.limit, 20, 1, 200);
    const [allMatchingDocs, overallTotal, activeTotal, inactiveTotal, withSymbolIdTotal, withoutSymbolIdTotal, tradingViewAddedTotal] = await Promise.all([
        MasterSymbol.find(filter).lean(),
        MasterSymbol.countDocuments(),
        MasterSymbol.countDocuments({ isActive: true }),
        MasterSymbol.countDocuments({ isActive: false }),
        MasterSymbol.countDocuments({ symbolId: { $exists: true, $ne: '' } }),
        MasterSymbol.countDocuments({
            $or: [
                { symbolId: { $exists: false } },
                { symbolId: null },
                { symbolId: '' }
            ]
        }),
        MasterSymbol.countDocuments({ tradingViewAdded: true }),
    ]);

    const filteredSymbols = applySegmentFilter(allMatchingDocs);
    const total = filteredSymbols.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const page = Math.min(requestedPage, totalPages);
    const skip = (page - 1) * limit;
    const symbols = filteredSymbols.slice(skip, skip + limit);

    res.send({
        results: symbols,
        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasPrevPage: page > 1,
            hasNextPage: page < totalPages,
        },
        summary: {
            total: overallTotal,
            active: activeTotal,
            inactive: inactiveTotal,
            withSymbolId: withSymbolIdTotal,
            withoutSymbolId: withoutSymbolIdTotal,
            tradingViewAdded: tradingViewAddedTotal,
            matched: total,
        },
    });
});

import Signal from '../models/Signal.js'; // Import Signal Model


const deleteSegment = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    // 1. Find the segment first
    const segment = await MasterSegment.findById(id);
    if (!segment) {
        return res.status(httpStatus.NOT_FOUND).send({ message: 'Segment not found' });
    }

    // 2. Check dependencies (Symbols)
    const symbolCount = await MasterSymbol.countDocuments({ segment: segment.code });
    if (symbolCount > 0) {
        return res.status(httpStatus.BAD_REQUEST).send({ 
            message: `Cannot delete. ${symbolCount} symbols are linked to this segment.` 
        });
    }

    // 3. Check dependencies (Signals)
    const signalCount = await Signal.countDocuments({ segment: segment.code });
    if (signalCount > 0) {
        return res.status(httpStatus.BAD_REQUEST).send({ 
            message: `Cannot delete. ${signalCount} active signals are linked to this segment.` 
        });
    }

    // 4. Safe to delete
    await MasterSegment.findByIdAndDelete(id);
    res.status(httpStatus.NO_CONTENT).send();
});

const deleteSymbol = catchAsync(async (req, res) => {
    const { id } = req.params;

    // 1. Find the symbol
    const symbol = await MasterSymbol.findById(id);
    if (!symbol) {
         return res.status(httpStatus.NOT_FOUND).send({ message: 'Symbol not found' });
    }

    // 2. Check dependencies (Signals)
    // We check if any Signal uses this symbol directly (by string name)
    const signalCount = await Signal.countDocuments({ symbol: symbol.symbol });
    if (signalCount > 0) {
        return res.status(httpStatus.BAD_REQUEST).send({ 
            message: `Cannot delete. ${signalCount} active signals are using this symbol.` 
        });
    }

    // 3. Delete
    await MasterSymbol.findByIdAndDelete(id);
    await marketDataService.loadMasterSymbols({ forceReload: true });
    await marketDataService.refreshSymbolsCache({ bumpVersion: true });
    res.status(httpStatus.NO_CONTENT).send();
});

const handleLogin = catchAsync(async (req, res) => {
    const { provider } = req.params;
    const payload = req.body; // { request_token } or { code }
    
    try {
        const session = await marketDataService.handleLogin(provider, payload);
        res.send(session);
    } catch (error) {
        res.status(httpStatus.BAD_REQUEST).send({ message: error.message });
    }
});

const handleLoginCallback = catchAsync(async (req, res) => {
    const { provider } = req.params;
    console.log(`\n--- CALLBACK RECEIVED [${provider}] ---`);
    console.log('Original URL:', req.originalUrl);
    console.log('Query Params:', req.query);

    const { code, request_token, auth_code } = req.query; // standard oauth params
    
    const finalCode = code || request_token || auth_code;
    
    if (!finalCode) {
        console.error(' Missing Code in Query params');
        return res.status(httpStatus.BAD_REQUEST).send(`
            <h1>Login Failed</h1>
            <p>No 'code' found in URL.</p>
            <p>Debug Data:</p>
            <pre>${JSON.stringify(req.query, null, 2)}</pre>
            <p>Ensure you did not remove parameters from the URL.</p>
        `);
    }

    try {
        await marketDataService.handleLogin(provider, { code: finalCode, request_token: finalCode });
        res.send('<h1>Login Successful!</h1><p>Token Generated. You can close this window.</p>');
    } catch (error) {
        console.error('Login Handling Error:', error);
        res.status(httpStatus.INTERNAL_SERVER_ERROR).send(`Login Failed: ${error.message}`);
    }
});

const getLoginUrl = catchAsync(async (req, res) => {
    const { provider } = req.params;
    
    // Ensure service uses latest settings
    await marketDataService.loadSettings();
    
    // Validate Provider
    let adapter = null;
    if (provider === 'kite') adapter = kiteService;
    else return res.status(httpStatus.BAD_REQUEST).send({ message: 'Invalid Provider' });

    // Check if key is configured (using generic keys from settings)
    // Check if key is configured (using generic keys from settings)
    let apiKey = null;
    let apiSecret = null;

    if (provider === 'kite') {
        apiKey = marketDataService.config.kite_api_key;
        apiSecret = marketDataService.config.kite_api_secret;
    }

    if (!apiKey) {
        return res.status(httpStatus.BAD_REQUEST).send({ message: 'API Key not configured' });
    }

    // Initialize specific adapter
    // For Login URL we typically only need API Key and Redirect URI
    // But generic init requires both usually.
    // Construct Redirect URI based on provider
    const redirectUri = `${req.protocol}://${req.get('host')}/market/login/${provider}/callback`; // e.g. NOT REAL ROUTE? 
    // Wait, the frontend handles redirect usually.
    // Let's assume the redirect_uri is fixed or backend generated.
    // Actually, for Kite it's set in App Console. For others passing it is allowed.
    // Let's use a standard localhost URI for now or what user configured.
    // Ideally user configures "Redirect URI" in settings but we don't have that field yet.
    // We will hardcode `http://localhost:5173/market/login/${provider}` (Frontend Route) as redirect.
    // OR backend route? Usually frontend receives code and POSTs to backend.
    
    const frontendCallback = `${config.frontendUrl}/market/login/${provider}`; // Frontend Page
    
    adapter.initialize(apiKey, apiSecret, frontendCallback);

    const url = adapter.getLoginUrl();
    res.send({ url });
});

const getHistory = catchAsync(async (req, res) => {
    const { symbol, resolution, from, to, count } = req.query;

    logger.info(`[HISTORY_REQUEST] Received from ${req.ip} - Symbol: ${symbol}, Resolution: ${resolution}, From: ${from}, To: ${to}, Count: ${count}`);
    logger.info(`[HISTORY_REQUEST] Headers: ${JSON.stringify(req.headers)}`);

    if (!symbol || !resolution) {
        logger.warn('[HISTORY_REQUEST] Missing parameters!');
        return res.status(httpStatus.BAD_REQUEST).send({ message: 'Missing required parameters: symbol, resolution' });
    }

    const resolvedCount = Math.max(parseIntegerQuery(count, 500, 1, 2000), 500);
    const now = Math.floor(Date.now() / 1000);
    const toValue = to ? to : now;
    const intervalSeconds = resolutionToSeconds(resolution);
    const fallbackFrom = now - (resolvedCount * intervalSeconds);
    const fromValue = from ? from : Math.max(0, fallbackFrom);

    logger.info(`History Request: ${symbol} (${resolution}) from ${fromValue} to ${toValue} count ${resolvedCount}`);
    const history = await marketDataService.getHistory(
        symbol,
        resolution,
        fromValue,
        toValue,
        resolvedCount,
        { throwOnAuthError: true }
    );
    logger.info(`[HISTORY_RESPONSE] Returning ${history.length} candles for ${symbol}`);
    res.send(history);
});

const searchInstruments = catchAsync(async (req, res) => {
    const { q } = req.query;
    const aliasMatches = getMatchingMarketSymbolAliases(q);
    const aliasDocs = aliasMatches.length > 0
        ? await MasterSymbol.find({
            symbol: { $in: Array.from(new Set(aliasMatches.map((item) => item.canonical))) },
            isActive: true,
        }).lean()
        : [];
    const aliasDocMap = buildSymbolDocMap(aliasDocs);
    const aliasBackedInstruments = aliasMatches
        .map((definition) => buildAliasBackedMarketSymbol(definition.alias, aliasDocMap.get(definition.canonical)))
        .filter(Boolean);

    let instruments = [
        ...aliasBackedInstruments,
        ...(await marketDataService.searchInstruments(q)),
    ];

    // Strict Segment Filtering based on User Plan
    if (req.user) {
        try {
            const { default: authService } = await import('../services/auth.service.js');
            const planData = await authService.getUserActivePlan(req.user);
            
            if (planData && planData.permissions.length > 0) {
                const perms = planData.permissions;
                const allowedSegments = [];
                const allowedExchanges = [];

                // 1. Map Permissions to Allowed Data Segments/Exchanges
                if (perms.includes('COMMODITY') || perms.includes('MCX_FUT')) {
                    allowedSegments.push('COMMODITY', 'COMEX');
                    allowedExchanges.push('MCX', 'COMEX'); 
                }
                if (perms.includes('EQUITY_INTRA') || perms.includes('EQUITY_DELIVERY')) {
                    allowedSegments.push('EQUITY', 'INDICES');
                    allowedExchanges.push('NSE');
                }
                if (perms.includes('NIFTY_OPT') || perms.includes('BANKNIFTY_OPT')) {
                    allowedSegments.push('FNO', 'INDICES'); 
                    allowedExchanges.push('NFO', 'MCX', 'CDS', 'BCD'); 
                }
                if (perms.includes('CURRENCY')) {
                    allowedSegments.push('CURRENCY', 'FOREX');
                    allowedExchanges.push('CDS', 'BCD');
                }
                if (perms.includes('CRYPTO')) {
                    allowedSegments.push('CRYPTO');
                    allowedExchanges.push('CRYPTO');
                }

                
                // Allow "Demo" plan to see everything OR restrict? 
                // User said: "Demo plan... commodity segment... sirf commodity dena hai"
                // So even Demo follows restriction if it has a segment attached.
                
                // 3. Filter Logic
                // If we have ANY restrictions, apply them. If no active sub found (or free user?), maybe allow all or restrict?
                // Assuming strict: If user has a plan, STRICTLY follow plan. 
                
                if (allowedSegments.length > 0 || allowedExchanges.length > 0) {
                     instruments = instruments.filter(item => {
                        const seg = item.segment || ''; // e.g. EQUITY, COMMODITY
                        const exc = item.exchange || ''; // e.g. NSE, MCX
                        
                        // Check if Item matches Allowed Segment OR Allowed Exchange
                        const segmentMatch = allowedSegments.includes(seg);
                        const exchangeMatch = allowedExchanges.includes(exc);
                        
                        return segmentMatch || exchangeMatch;
                    });
                }
            }
        } catch (err) {
            logger.error(`Error filtering segments for user ${req.user.id}: ${err.message}`);
            // On error, maybe fail open or closed? 
            // Better to fail open (return results) or log? 
            // Let's return filtered if possible, but if error, return all (fallback)
        }
    }

    const normalizedQuery = normalizeUpper(q);
    const SEARCH_ALIAS_SUFFIX_PATTERN = /(?:\.PR|\.P|\.X|\.LV|\.PERP|PERP)$/i;
    const STABLE_QUOTE_SUFFIX_PATTERN = /(USDT|USDC|BUSD)$/i;
    const getSearchAliasBase = (value = '') => {
        let normalized = normalizeUpper(value).split(':').pop() || '';
        if (!normalized) return '';

        let previous = '';
        while (normalized && normalized !== previous) {
            previous = normalized;
            normalized = normalized.replace(SEARCH_ALIAS_SUFFIX_PATTERN, '');
        }

        return normalized.replace(STABLE_QUOTE_SUFFIX_PATTERN, 'USD');
    };
    const queryAliasBase = getSearchAliasBase(normalizedQuery);
    const matchesSearchSymbol = (item = {}) => {
        const symbol = normalizeUpper(item.symbol);
        const aliasBase = getSearchAliasBase(symbol);
        if (!normalizedQuery || !symbol) return false;
        if (symbol.includes(normalizedQuery)) return true;
        if (queryAliasBase && aliasBase.includes(queryAliasBase)) return true;
        return false;
    };
    const getSearchCandidateRank = (item = {}) => {
        const symbol = normalizeUpper(item.symbol);
        const name = normalizeUpper(item.name);
        let rank = 0;

        if (/\.LV$/i.test(symbol) || /\.P(R)?$/i.test(symbol) || /LEVERAGE|PERP|PERPETUAL|FUT/i.test(name)) {
            rank += 20;
        }
        if (symbol.endsWith('USDT') || symbol.endsWith('USDC') || symbol.endsWith('BUSD')) {
            rank += 5;
        }
        if (!item.symbolId) {
            rank += 1;
        }

        return rank;
    };
    const dedupeSearchResults = (items = []) => {
        const map = new Map();

        items.forEach((item) => {
            const key = getSearchAliasBase(item.symbol);
            if (!key) return;

            const existing = map.get(key);
            if (!existing) {
                map.set(key, item);
                return;
            }

            const existingRank = getSearchCandidateRank(existing);
            const candidateRank = getSearchCandidateRank(item);
            if (candidateRank < existingRank) {
                map.set(key, item);
                return;
            }
            if (candidateRank > existingRank) {
                return;
            }

            const existingSymbolLength = String(existing.symbol || '').length;
            const candidateSymbolLength = String(item.symbol || '').length;
            if (candidateSymbolLength && existingSymbolLength && candidateSymbolLength < existingSymbolLength) {
                map.set(key, item);
            }
        });

        return Array.from(map.values());
    };

    const decorated = instruments.map((item) => decorateSymbolSegment(item));
    const narrowed = normalizedQuery
        ? (() => {
            const symbolMatches = decorated.filter(matchesSearchSymbol);
            return symbolMatches.length > 0 ? symbolMatches : decorated;
        })()
        : decorated;
    const deduped = dedupeSearchResults(narrowed);
    const spotFiltered = deduped.filter(isCryptoSpotItem);
    const preferred = preferCryptoUsdOverUsdt(spotFiltered);
    res.send(preferred);
});

const syncInstruments = catchAsync(async (req, res) => {
    const result = await marketDataService.syncInstruments();
    res.send(result);
});

export default {
    seedMarketData,
    getSegments,
    getWatchlistTemplates,
    createWatchlistTemplate,
    updateWatchlistTemplate,
    deleteWatchlistTemplate,
    createSegment,
    deleteSegment,
    updateSegment,
    getSymbols,
    createSymbol,
    updateSymbol,
    generateSymbolId,
    updateTradingViewStatus,
    deleteSymbol,
    handleLogin,
    handleLoginCallback,
    getLoginUrl,
    getHistory,
    searchInstruments,
    syncInstruments,
    getTickers, // New
    getSentiment, // New
    getSymbolAnalysis,
    getNews,
    getUserWatchlists,
    createUserWatchlist,
    updateUserWatchlist,
    deleteUserWatchlist,
    getUserWatchlist,
    addUserWatchlist,
    removeUserWatchlist,
    reorderUserWatchlist,
    getMarketStats: (req, res) => {
        const includePrices = parseBooleanQuery(req.query.includePrices);
        const stats = marketDataService.getStats({
            includePrices: includePrices !== undefined ? includePrices : true
        });
        res.send(stats);
    }
};

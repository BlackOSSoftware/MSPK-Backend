import { isCryptoLikeSymbol, mapPreferredSegmentsToAudienceGroups } from './signalRouting.js';
import { MARKET_SYMBOL_ALIAS_DEFINITIONS } from './marketSymbolAliases.js';

const MAX_SELECTED_SYMBOLS_PER_SEGMENT = 10;
const DEFAULT_SIGNAL_SELECTION_BY_GROUP = {
  EQUITY: ['NSE:NIFTY 50-INDEX', 'NSE:BANKNIFTY', 'NSE:RELIANCE'],
  FNO: ['NSE:BANKNIFTY', 'NSE:NIFTY 50-INDEX'],
  COMMODITY: ['XAUUSD', 'XAGUSD', 'GC1!', 'MCX:SILVER'],
  CURRENCY: ['EURUSD'],
  CRYPTO: ['BTCUSD', 'ETHUSDT'],
};
const DEFAULT_SIGNAL_SELECTION_FALLBACK = Array.from(
  new Set(Object.values(DEFAULT_SIGNAL_SELECTION_BY_GROUP).flat())
);
const INDEX_SYMBOL_ALIAS_GROUPS = [
  ['NIFTY', 'NIFTY1!', 'NIFTY50', 'NSE:NIFTY', 'NSE:NIFTY50', 'NSE:NIFTY 50', 'NSE:NIFTY 50-INDEX'],
  ['BANKNIFTY', 'BANKNIFTY1!', 'NSE:BANKNIFTY', 'NSE:NIFTYBANK', 'NSE:NIFTY BANK', 'NSE:NIFTY BANK-INDEX'],
  ['FINNIFTY', 'FINNIFTY1!', 'NSE:FINNIFTY', 'NSE:NIFTY FIN SERVICE', 'NSE:NIFTY FIN SERVICE-INDEX'],
];

const INDEX_SYMBOL_ALIAS_MAP = new Map(
  INDEX_SYMBOL_ALIAS_GROUPS.flatMap((group) => group.map((symbol) => [symbol, group]))
);
const MARKET_SYMBOL_ALIAS_GROUPS = MARKET_SYMBOL_ALIAS_DEFINITIONS
  .map((definition) => Array.from(new Set([
    String(definition?.alias || '').trim().toUpperCase(),
    String(definition?.canonical || '').trim().toUpperCase(),
  ].filter(Boolean))))
  .filter((group) => group.length > 1);

const MARKET_SYMBOL_ALIAS_MAP = new Map(
  MARKET_SYMBOL_ALIAS_GROUPS.flatMap((group) => group.map((symbol) => [symbol, group]))
);

const COMMODITY_SYMBOL_ALIAS_GROUPS = [
  ['XAUUSD', 'XAUUSD.PR', 'XAUUSD.X', 'GC1!', 'COMEX:GC1!', 'GOLD1!', 'COMEX:GOLD', 'GOLD'],
  ['XAGUSD', 'XAGUSD.PR', 'XAGUSD.X', 'SI1!', 'COMEX:SI1!', 'COMEX:SILVER', 'SILVER'],
  ['MCX:SILVER', 'MCX:SILVER1!', 'SILVER1!'],
  ['WTI', 'USOIL', 'USOILROLL', 'CL1!', 'NYMEX:CL1!', 'CRUDEOIL', 'CRUDE OIL'],
  ['BRENTUSD', 'UKOIL', 'UKOILROLL', 'BRN1!', 'NYMEX:BRN1!', 'BRENT', 'BRENT OIL'],
  ['NATGASUSD', 'NG1!', 'NYMEX:NG1!', 'NATGAS', 'NATURAL GAS'],
];

const COMMODITY_SYMBOL_ALIAS_MAP = new Map(
  COMMODITY_SYMBOL_ALIAS_GROUPS.flatMap((group) => group.map((symbol) => [symbol, group]))
);

const getCommodityContinuousAliases = (symbol = '') => {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) return [];

  const aliases = new Set();
  const rootMatch = normalized.match(/^MCX:([A-Z]+)$/);
  if (rootMatch) {
    const [, root] = rootMatch;
    aliases.add(`${root}1!`);
    aliases.add(`MCX:${root}1!`);
    return Array.from(aliases);
  }

  const continuousMatch = normalized.match(/^(?:MCX:)?([A-Z]+)1!$/);
  if (!continuousMatch) return [];

  const [, root] = continuousMatch;
  aliases.add(`MCX:${root}`);
  aliases.add(`${root}1!`);
  aliases.add(`MCX:${root}1!`);
  return Array.from(aliases);
};

const getSelectedSymbolAliases = (symbol = '') => {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) return [];

  const aliases = new Set([normalized]);
  const indexAliasGroup = INDEX_SYMBOL_ALIAS_MAP.get(normalized);
  const commodityAliasGroup = COMMODITY_SYMBOL_ALIAS_MAP.get(normalized);
  const marketAliasGroup = MARKET_SYMBOL_ALIAS_MAP.get(normalized);
  if (indexAliasGroup) {
    indexAliasGroup.forEach((alias) => aliases.add(alias));
  } else if (marketAliasGroup) {
    marketAliasGroup.forEach((alias) => aliases.add(alias));
  } else if (commodityAliasGroup) {
    commodityAliasGroup.forEach((alias) => aliases.add(alias));
    getCommodityContinuousAliases(normalized).forEach((alias) => aliases.add(alias));
  } else {
    getCommodityContinuousAliases(normalized).forEach((alias) => aliases.add(alias));
  }

  if (!isCryptoLikeSymbol(normalized)) {
    return Array.from(aliases);
  }

  const stripped = normalized.replace(/(\.P|PERP)$/i, '');
  const derivativeSuffix = normalized.slice(stripped.length);

  if (stripped.endsWith('USDT')) {
    aliases.add(`${stripped.slice(0, -1)}${derivativeSuffix}`);
  } else if (stripped.endsWith('USD')) {
    aliases.add(`${stripped}T${derivativeSuffix}`);
  }

  return Array.from(aliases);
};

const expandSelectedSymbols = (symbols = []) =>
  Array.from(
    new Set(
      normalizeSelectedSymbols(symbols).flatMap((symbol) => getSelectedSymbolAliases(symbol))
    )
  );

const normalizeSelectedSymbols = (symbols = []) =>
  Array.from(
    new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map((symbol) => String(symbol || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );

const buildSelectedSymbolDocsMap = (symbolDocs = []) =>
  new Map(
    (Array.isArray(symbolDocs) ? symbolDocs : [])
      .map((doc) => [String(doc?.symbol || '').trim().toUpperCase(), doc])
      .filter(([symbol]) => Boolean(symbol))
  );

const deriveDefaultSignalSelectionSymbols = (preferredSegments = []) => {
  const audienceGroups = mapPreferredSegmentsToAudienceGroups(preferredSegments);
  const resolvedGroups = audienceGroups.includes('ALL') || audienceGroups.length === 0
    ? ['EQUITY', 'FNO', 'COMMODITY', 'CURRENCY', 'CRYPTO']
    : audienceGroups.filter((group) => Object.prototype.hasOwnProperty.call(DEFAULT_SIGNAL_SELECTION_BY_GROUP, group));

  const fallbackSymbols = resolvedGroups.length > 0
    ? resolvedGroups.flatMap((group) => DEFAULT_SIGNAL_SELECTION_BY_GROUP[group] || [])
    : DEFAULT_SIGNAL_SELECTION_FALLBACK;

  return normalizeSelectedSymbols(fallbackSymbols);
};

const getSelectionBucketKey = (symbolDoc = {}) => {
  const segment = String(symbolDoc?.segment || '').trim().toUpperCase();
  const exchange = String(symbolDoc?.exchange || '').trim().toUpperCase();
  const subsegment = String(symbolDoc?.subsegment || '').trim().toUpperCase();
  const symbol = String(symbolDoc?.symbol || '').trim().toUpperCase();
  const name = String(symbolDoc?.name || '').trim().toUpperCase();
  const tags = Array.isArray(symbolDoc?.meta?.tags)
    ? symbolDoc.meta.tags.map((tag) => String(tag || '').trim().toUpperCase())
    : [];

  if (exchange === 'MCX') return 'COMMODITY';

  if (
    exchange === 'COMEX' ||
    exchange === 'NYMEX' ||
    (segment === 'COMMODITY' && exchange && exchange !== 'MCX') ||
    (segment === 'FNO' && ['COMEX', 'NYMEX'].includes(exchange)) ||
    ['ENERGY', 'METALS', 'AGRICULTURE', 'FUTURES_OTHER', 'RATES_FUTURES'].includes(subsegment) ||
    tags.includes('COMMODITY') ||
    tags.includes('METALS') ||
    tags.includes('ENERGY') ||
    /(?:CRUDE|WTI|BRENT|USOIL|UKOIL|XAU|XAG|GC\d*!|SI\d*!|CL\d*!|NG\d*!|HG\d*!)/.test(symbol) ||
    /(?:CRUDE|WTI|BRENT|COMEX|NYMEX|GOLD|SILVER|NATURAL GAS|COPPER)/.test(name)
  ) {
    return 'COMEX';
  }

  if (segment === 'CURRENCY' || segment === 'FOREX') {
    return 'FOREX';
  }

  if (exchange === 'FOREX') return 'FOREX';
  if (segment) return segment;
  return exchange || 'OTHER';
};

const limitSelectedSymbolsPerSegment = (
  symbols = [],
  symbolDocsBySymbol = new Map(),
  maxPerSegment = MAX_SELECTED_SYMBOLS_PER_SEGMENT
) => {
  const normalizedSymbols = normalizeSelectedSymbols(symbols);
  if (normalizedSymbols.length === 0) return [];

  const segmentCounts = new Map();
  const selectedSymbols = [];

  for (const symbol of normalizedSymbols) {
    const segmentKey = getSelectionBucketKey(symbolDocsBySymbol.get(symbol));
    const count = segmentCounts.get(segmentKey) || 0;
    if (count >= maxPerSegment) continue;

    segmentCounts.set(segmentKey, count + 1);
    selectedSymbols.push(symbol);
  }

  return selectedSymbols;
};

const getUserSelectedSymbols = (user, symbolDocsBySymbol = null) =>
  symbolDocsBySymbol instanceof Map
    ? limitSelectedSymbolsPerSegment(user?.marketWatchlist, symbolDocsBySymbol)
    : normalizeSelectedSymbols(user?.marketWatchlist);

const isSignalSelectionInitialized = (user) =>
  Boolean(user?.signalWatchlistInitializedAt) ||
  normalizeSelectedSymbols(user?.signalWatchlist).length > 0;

const hasExplicitUserSignalSelection = (user) =>
  Array.isArray(user?.signalWatchlist) && isSignalSelectionInitialized(user);

const getUserSignalSelectionSource = (user) => {
  if (hasExplicitUserSignalSelection(user)) {
    return user?.signalWatchlist;
  }

  const marketWatchlist = normalizeSelectedSymbols(user?.marketWatchlist);
  if (marketWatchlist.length > 0) {
    return marketWatchlist;
  }

  return deriveDefaultSignalSelectionSymbols(user?.preferredSegments);
};

const getUserSignalSelectedSymbols = (user, symbolDocsBySymbol = null) =>
  symbolDocsBySymbol instanceof Map
    ? limitSelectedSymbolsPerSegment(getUserSignalSelectionSource(user), symbolDocsBySymbol)
    : normalizeSelectedSymbols(getUserSignalSelectionSource(user));

const setUserSignalSelectedSymbols = (user, symbols = [], symbolDocsBySymbol = null) => {
  const normalizedSymbols =
    symbolDocsBySymbol instanceof Map
      ? limitSelectedSymbolsPerSegment(symbols, symbolDocsBySymbol)
      : normalizeSelectedSymbols(symbols);

  if (user) {
    user.signalWatchlist = normalizedSymbols;
    user.signalWatchlistInitializedAt = new Date();
  }

  return normalizedSymbols;
};

const initializeUserSignalSelectedSymbols = (user, symbolDocsBySymbol = null) => {
  if (!user || user.role === 'admin') {
    return {
      symbols: normalizeSelectedSymbols(user?.signalWatchlist),
      didUpdate: false,
    };
  }

  const currentSymbols = normalizeSelectedSymbols(user?.signalWatchlist);
  const hadInitializedAt = Boolean(user?.signalWatchlistInitializedAt);

  if (hasExplicitUserSignalSelection(user) && currentSymbols.length > 0) {
    if (hadInitializedAt) {
      return { symbols: currentSymbols, didUpdate: false };
    }

    user.signalWatchlistInitializedAt = new Date();
    return { symbols: currentSymbols, didUpdate: true };
  }

  const derivedSymbols = symbolDocsBySymbol instanceof Map
    ? limitSelectedSymbolsPerSegment(getUserSignalSelectionSource(user), symbolDocsBySymbol)
    : normalizeSelectedSymbols(getUserSignalSelectionSource(user));

  if (derivedSymbols.length === 0) {
    return {
      symbols: currentSymbols,
      didUpdate: false,
    };
  }

  setUserSignalSelectedSymbols(user, derivedSymbols, symbolDocsBySymbol);
  const nextSymbols = normalizeSelectedSymbols(user?.signalWatchlist);

  return {
    symbols: nextSymbols,
    didUpdate: currentSymbols.join('|') !== nextSymbols.join('|') || !hadInitializedAt,
  };
};

const buildSelectedSignalFilter = (symbols = []) => {
  const selectedSymbols = expandSelectedSymbols(symbols);
  if (selectedSymbols.length === 0) {
    return { _id: { $in: [] } };
  }

  return { symbol: { $in: selectedSymbols } };
};

const hasSelectedSignalSymbol = (symbols = [], signalSymbol = '') => {
  const normalizedSignal = String(signalSymbol || '').trim().toUpperCase();
  if (!normalizedSignal) return false;

  return expandSelectedSymbols(symbols).includes(normalizedSignal);
};

export {
  MAX_SELECTED_SYMBOLS_PER_SEGMENT,
  buildSelectedSignalFilter,
  buildSelectedSymbolDocsMap,
  deriveDefaultSignalSelectionSymbols,
  expandSelectedSymbols,
  getSelectionBucketKey,
  initializeUserSignalSelectedSymbols,
  getUserSignalSelectedSymbols,
  getUserSelectedSymbols,
  getUserSignalSelectionSource,
  hasExplicitUserSignalSelection,
  hasSelectedSignalSymbol,
  isSignalSelectionInitialized,
  limitSelectedSymbolsPerSegment,
  normalizeSelectedSymbols,
  setUserSignalSelectedSymbols,
};

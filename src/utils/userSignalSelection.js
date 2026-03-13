import { isCryptoLikeSymbol } from './signalRouting.js';

const MAX_SELECTED_SYMBOLS_PER_SEGMENT = 10;
const INDEX_SYMBOL_ALIAS_GROUPS = [
  ['NIFTY', 'NIFTY1!', 'NIFTY50', 'NSE:NIFTY', 'NSE:NIFTY50', 'NSE:NIFTY 50', 'NSE:NIFTY 50-INDEX'],
  ['BANKNIFTY', 'BANKNIFTY1!', 'NSE:BANKNIFTY', 'NSE:NIFTYBANK', 'NSE:NIFTY BANK', 'NSE:NIFTY BANK-INDEX'],
  ['FINNIFTY', 'FINNIFTY1!', 'NSE:FINNIFTY', 'NSE:NIFTY FIN SERVICE', 'NSE:NIFTY FIN SERVICE-INDEX'],
];

const INDEX_SYMBOL_ALIAS_MAP = new Map(
  INDEX_SYMBOL_ALIAS_GROUPS.flatMap((group) => group.map((symbol) => [symbol, group]))
);

const getSelectedSymbolAliases = (symbol = '') => {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) return [];

  const aliases = new Set([normalized]);
  const indexAliasGroup = INDEX_SYMBOL_ALIAS_MAP.get(normalized);
  if (indexAliasGroup) {
    indexAliasGroup.forEach((alias) => aliases.add(alias));
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
  expandSelectedSymbols,
  getSelectionBucketKey,
  getUserSelectedSymbols,
  hasSelectedSignalSymbol,
  limitSelectedSymbolsPerSegment,
  normalizeSelectedSymbols,
};

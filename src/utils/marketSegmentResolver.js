const normalizeUpper = (value) => String(value ?? '').trim().toUpperCase();

const KNOWN_EXCHANGE_PREFIXES = new Set([
  'NSE',
  'BSE',
  'NFO',
  'MCX',
  'CDS',
  'BCD',
  'NSEIX',
  'COMEX',
  'NYMEX',
  'FOREX',
  'CRYPTO',
  'BINANCE',
]);

// Exchanges that represent Indian venues. We treat these as "explicitly Indian" only when
// they come from a reliable source (Kite) or from a symbol prefix like "NSE:...".
const INDIAN_EXCHANGES = new Set(['NSE', 'BSE', 'MCX', 'NFO', 'CDS', 'BCD', 'NSEIX']);

const FOREX_CODES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'INR', 'SGD', 'HKD', 'CNY', 'CNH',
  'SEK', 'NOK', 'DKK', 'ZAR', 'RUB', 'TRY', 'MXN', 'BRL', 'KRW', 'PLN', 'THB', 'IDR', 'MYR',
  'PHP', 'VND', 'TWD', 'SAR', 'AED', 'QAR', 'KWD', 'BHD', 'OMR', 'ILS',
]);

const INDEX_HINTS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX', 'BANKEX', 'VIX', 'INDEX'];
const COMMODITY_REGEX = /(?:CRUDE|WTI|BRENT|USOIL|UKOIL|XAU|XAG|GOLD|SILVER|NATURAL GAS|NG|COPPER|ALUMINIUM|ZINC|LEAD|NICKEL|MENTHA|COTTON|GUAR|JEERA|SOY|WHEAT|CORN|SUGAR)/i;
const COMEX_EXCHANGES = new Set(['COMEX', 'NYMEX']);
const COMEX_SUBSEGMENTS = new Set(['ENERGY', 'METALS', 'AGRICULTURE', 'FUTURES_OTHER', 'RATES_FUTURES']);

const isCryptoLikeSymbol = (symbol = '') => {
  const normalized = normalizeUpper(symbol).replace(/(\.P|PERP)$/i, '');
  if (!normalized) return false;
  if (normalized.includes('USDT') || normalized.includes('USDC') || normalized.includes('BUSD')) return true;
  if (/BTC|ETH|SOL|XRP|DOGE|BNB|ADA|AVAX|MATIC|LTC|DOT|TRX/i.test(normalized) && normalized.endsWith('USD')) {
    return true;
  }
  return false;
};

const isIndexLikeSymbol = (symbol = '', name = '') => {
  const haystack = `${normalizeUpper(symbol)} ${normalizeUpper(name)}`;
  return INDEX_HINTS.some((hint) => haystack.includes(hint)) || haystack.includes('-INDEX');
};

const isCommodityLikeSymbol = (symbol = '', name = '') => COMMODITY_REGEX.test(`${symbol} ${name}`);

const isForexPair = (symbol = '') => {
  const normalized = normalizeUpper(symbol).replace(/[^A-Z]/g, '');
  if (normalized.length !== 6) return false;
  const base = normalized.slice(0, 3);
  const quote = normalized.slice(3, 6);
  return FOREX_CODES.has(base) && FOREX_CODES.has(quote);
};

const extractExchangePrefix = (symbol = '') => {
  const normalized = normalizeUpper(symbol);
  const match = normalized.match(/^([A-Z0-9]+):/);
  const prefix = match?.[1] || '';
  if (!prefix) return '';
  if (!KNOWN_EXCHANGE_PREFIXES.has(prefix)) return '';
  return prefix;
};

const resolveSymbolSegmentGroup = (symbolDoc = {}) => {
  const segment = normalizeUpper(symbolDoc?.segment);
  const rawExchange = normalizeUpper(symbolDoc?.exchange);
  const subsegment = normalizeUpper(symbolDoc?.subsegment);
  const symbol = normalizeUpper(symbolDoc?.symbol || symbolDoc?.sourceSymbol);
  const name = normalizeUpper(symbolDoc?.name);
  const provider = normalizeUpper(symbolDoc?.provider);

  const symbolExchange = extractExchangePrefix(symbol);
  const exchange = symbolExchange || rawExchange;
  const isExplicitIndianExchange =
    (symbolExchange && INDIAN_EXCHANGES.has(symbolExchange)) ||
    (provider === 'KITE' && exchange && INDIAN_EXCHANGES.has(exchange));

  if (
    isCryptoLikeSymbol(symbol) ||
    ['CRYPTO', 'BINANCE'].includes(segment) ||
    ['CRYPTO', 'BINANCE'].includes(exchange)
  ) {
    return 'CRYPTO';
  }

  const isComexSegment = COMEX_EXCHANGES.has(segment);
  const isComexExchange = COMEX_EXCHANGES.has(exchange);

  const isMcx = exchange === 'MCX' || segment === 'MCX';
  if (isMcx) {
    return 'COMMODITY';
  }

  if (isComexExchange || isComexSegment) {
    return 'COMEX';
  }

  const isCommodityHint = isCommodityLikeSymbol(symbol, name);
  if (isCommodityHint && !isExplicitIndianExchange) {
    // Outside MCX, commodity-like symbols belong to the global COMEX bucket (e.g. XAUUSD, XAGUSD, USOIL).
    return 'COMEX';
  }

  if (
    ['COMMODITY', 'MCX'].includes(segment)
  ) {
    // If something was stored as COMMODITY but is not explicitly MCX, treat it as COMEX (global commodities).
    return 'COMEX';
  }

  if (
    ['CURRENCY', 'FOREX', 'CDS', 'BCD', 'FX', 'CUR'].includes(segment) ||
    ['FOREX', 'CDS', 'BCD'].includes(exchange) ||
    isForexPair(symbol)
  ) {
    return 'CURRENCY';
  }

  if (
    ['INDICES', 'INDEX', 'NSEIX'].includes(segment) ||
    exchange === 'NSEIX' ||
    isIndexLikeSymbol(symbol, name)
  ) {
    return 'INDICES';
  }

  if (
    ['FNO', 'FO', 'NFO', 'OPTIONS', 'OPTION', 'FUTURES'].includes(segment) ||
    exchange === 'NFO'
  ) {
    return 'FNO';
  }

  if (
    ['EQUITY', 'EQ', 'CM', 'NSE', 'BSE'].includes(segment) ||
    ['NSE', 'BSE'].includes(exchange)
  ) {
    return 'EQUITY';
  }

  if (isComexSegment && !isComexCommodityHint && !isComexExchange) {
    return exchange || 'OTHER';
  }

  return segment || exchange || 'OTHER';
};

const matchesSegmentGroup = (symbolDoc = {}, requestedSegment = '') => {
  const expected = normalizeUpper(requestedSegment);
  if (!expected) return true;
  return resolveSymbolSegmentGroup(symbolDoc) === expected;
};

const decorateSymbolSegment = (symbolDoc = {}) => ({
  ...symbolDoc,
  rawSegment: normalizeUpper(symbolDoc?.rawSegment || symbolDoc?.segment),
  segmentGroup: resolveSymbolSegmentGroup(symbolDoc),
});

export {
  decorateSymbolSegment,
  matchesSegmentGroup,
  normalizeUpper,
  resolveSymbolSegmentGroup,
};

import { normalizeUpper } from './marketSegmentResolver.js';

const MARKET_SYMBOL_ALIAS_DEFINITIONS = [
  {
    alias: 'BRENTUSD',
    canonical: 'UKOILROLL',
    wireSymbols: ['UKOILROLL', 'UKOILK6', 'UKOILM6'],
    name: 'Brent Crude Oil',
    searchTerms: ['BRENT', 'BRENT CRUDE', 'UK OIL', 'UKOIL'],
  },
  {
    alias: 'NATGASUSD',
    canonical: 'NG1!',
    wireSymbols: ['NG1!', 'NGJ6', 'NGK6'],
    name: 'Natural Gas Spot / US Dollar',
    searchTerms: ['NATGAS', 'NATURAL GAS', 'NG'],
  },
  {
    alias: 'COPPERUSD',
    canonical: 'HG1!',
    wireSymbols: ['HG1!', 'HGK6'],
    name: 'Copper Spot / US Dollar',
    searchTerms: ['COPPER', 'HIGH GRADE COPPER', 'HG'],
  },
  {
    alias: 'XPTUSD',
    canonical: 'XPTUSD.PR',
    wireSymbols: ['XPTUSD.PR', 'XPTUSD.X'],
    name: 'Platinum Spot / US Dollar',
    searchTerms: ['XPTUSD', 'PLATINUM'],
  },
  {
    alias: 'NAS100',
    canonical: 'UT100ROLL',
    wireSymbols: ['UT100ROLL', 'UT100H6', 'UT100M6'],
    name: 'US Tech 100 Cash Index',
    searchTerms: ['NAS100', 'NASDAQ', 'NASDAQ 100', 'US TECH 100', 'UT100'],
  },
  {
    alias: 'US30',
    canonical: 'US30ROLL',
    wireSymbols: ['US30ROLL', 'US30H6', 'US30M6'],
    name: 'US Wall Street 30 Cash Index',
    searchTerms: ['US30', 'DOW', 'DOW JONES', 'WALL STREET 30'],
  },
  {
    alias: 'SPX500',
    canonical: 'US500ROLL',
    wireSymbols: ['US500ROLL', 'US500H6', 'US500M6'],
    name: 'US SPX 500 Cash Index',
    searchTerms: ['SPX500', 'US500', 'SP500', 'S&P 500'],
  },
];

const UNSUPPORTED_WATCHLIST_SYMBOLS = new Set(['XPDUSD']);

const MARKET_SYMBOL_ALIAS_MAP = new Map(
  MARKET_SYMBOL_ALIAS_DEFINITIONS.map((definition) => [
    normalizeUpper(definition.alias),
    {
      ...definition,
      alias: normalizeUpper(definition.alias),
      canonical: normalizeUpper(definition.canonical),
      wireSymbols: Array.from(
        new Set(
          (Array.isArray(definition.wireSymbols) ? definition.wireSymbols : [definition.canonical])
            .map((value) => normalizeUpper(value))
            .filter(Boolean)
        )
      ),
      searchTerms: Array.from(
        new Set(
          (Array.isArray(definition.searchTerms) ? definition.searchTerms : [])
            .map((value) => normalizeUpper(value))
            .filter(Boolean)
        )
      ),
      name: String(definition.name || '').trim(),
    },
  ])
);

const normalizeMarketAliasInput = (value = '') => normalizeUpper(value);

const getMarketSymbolAliasDefinition = (symbol = '') => {
  const normalized = normalizeMarketAliasInput(symbol);
  if (!normalized) return null;
  return MARKET_SYMBOL_ALIAS_MAP.get(normalized) || null;
};

const getMarketAliasLookupSymbols = (symbol = '') => {
  const normalized = normalizeMarketAliasInput(symbol);
  const definition = getMarketSymbolAliasDefinition(normalized);
  return Array.from(new Set([normalized, definition?.canonical].filter(Boolean)));
};

const buildAliasBackedMarketSymbol = (symbol = '', canonicalDoc = null) => {
  const normalized = normalizeMarketAliasInput(symbol);
  const definition = getMarketSymbolAliasDefinition(normalized);
  if (!definition || !canonicalDoc) return null;

  const base = typeof canonicalDoc?.toObject === 'function'
    ? canonicalDoc.toObject()
    : { ...canonicalDoc };

  return {
    ...base,
    symbol: normalized,
    name: definition.name || base.name || normalized,
    sourceSymbol: base.sourceSymbol || base.symbol || definition.canonical,
    provider: base.provider || 'market_data',
    isActive: base.isActive !== false,
    meta: {
      ...(base?.meta && typeof base.meta === 'object' ? base.meta : {}),
      liveFeedSupported: true,
      aliasOf: base.symbol || definition.canonical,
    },
  };
};

const matchesMarketSymbolAliasQuery = (query = '', definition = null) => {
  const normalizedQuery = normalizeMarketAliasInput(query);
  if (!normalizedQuery || !definition) return false;

  const haystacks = [
    definition.alias,
    definition.canonical,
    normalizeUpper(definition.name),
    ...(Array.isArray(definition.searchTerms) ? definition.searchTerms : []),
  ].filter(Boolean);

  return haystacks.some((value) => (
    value.includes(normalizedQuery) || normalizedQuery.includes(value)
  ));
};

const getMatchingMarketSymbolAliases = (query = '') => {
  const normalizedQuery = normalizeMarketAliasInput(query);
  if (!normalizedQuery) return [];

  return MARKET_SYMBOL_ALIAS_DEFINITIONS
    .map((definition) => getMarketSymbolAliasDefinition(definition.alias))
    .filter((definition) => matchesMarketSymbolAliasQuery(normalizedQuery, definition));
};

const isUnsupportedWatchlistSymbol = (symbol = '') =>
  UNSUPPORTED_WATCHLIST_SYMBOLS.has(normalizeMarketAliasInput(symbol));

export {
  MARKET_SYMBOL_ALIAS_DEFINITIONS,
  buildAliasBackedMarketSymbol,
  getMarketAliasLookupSymbols,
  getMatchingMarketSymbolAliases,
  getMarketSymbolAliasDefinition,
  isUnsupportedWatchlistSymbol,
  matchesMarketSymbolAliasQuery,
  normalizeMarketAliasInput,
};

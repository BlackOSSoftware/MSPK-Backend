const DEFAULT_MARKET_WATCHLIST_TEMPLATES = [
  {
    key: 'segment_equity',
    name: 'Equity',
    order: 10,
    symbolLimit: 25,
    preferredSymbols: [],
    selector: {
      segments: ['EQUITY'],
      exchanges: ['NSE', 'BSE'],
    },
  },
  {
    key: 'segment_fno',
    name: 'FNO',
    order: 20,
    symbolLimit: 25,
    preferredSymbols: [],
    selector: {
      segments: ['FNO'],
      exchanges: ['NFO'],
    },
  },
  {
    key: 'segment_indices',
    name: 'Indices',
    order: 30,
    symbolLimit: 20,
    preferredSymbols: [],
    selector: {
      segments: ['INDICES'],
      symbolIncludes: ['-INDEX'],
      symbolPrefixes: ['NSE:NIFTY'],
      nameIncludes: ['INDEX'],
    },
  },
  {
    key: 'segment_commodity',
    name: 'Commodity',
    order: 40,
    symbolLimit: 25,
    preferredSymbols: [],
    selector: {
      segments: ['COMMODITY', 'MCX'],
      exchanges: ['MCX'],
    },
  },
  {
    key: 'segment_comex',
    name: 'Comex',
    order: 50,
    symbolLimit: 25,
    preferredSymbols: [],
    selector: {
      bucket: 'COMEX',
    },
  },
  {
    key: 'segment_currency',
    name: 'Currency',
    order: 60,
    symbolLimit: 25,
    preferredSymbols: [],
    selector: {
      bucket: 'FOREX',
      segments: ['CURRENCY', 'FOREX'],
      exchanges: ['FOREX', 'CDS', 'BCD'],
    },
  },
  {
    key: 'segment_crypto',
    name: 'Crypto',
    order: 70,
    symbolLimit: 25,
    preferredSymbols: [],
    selector: {
      segments: ['CRYPTO'],
      exchanges: ['CRYPTO', 'BINANCE'],
    },
  },
];

export {
  DEFAULT_MARKET_WATCHLIST_TEMPLATES,
};


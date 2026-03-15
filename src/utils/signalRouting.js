const normalizeUpper = (value) => String(value ?? '').trim().toUpperCase();

const stripDerivativeSuffix = (symbol) => normalizeUpper(symbol).replace(/(\.P|PERP)$/i, '');

const isCryptoLikeSymbol = (symbol) => {
  const sym = stripDerivativeSuffix(symbol);
  if (!sym) return false;

  if (sym.includes('USDT') || sym.includes('USDC') || sym.includes('BUSD')) return true;

  if (sym.endsWith('USD') && sym.length > 3) {
    const base = sym.slice(0, -3);
    const fiatBases = new Set([
      'USD',
      'EUR',
      'GBP',
      'JPY',
      'AUD',
      'CAD',
      'CHF',
      'NZD',
      'INR',
      'SGD',
      'HKD',
      'CNY',
      'CNH',
      'SEK',
      'NOK',
      'DKK',
      'ZAR',
      'RUB',
      'TRY',
      'MXN',
      'BRL',
      'KRW',
      'PLN',
      'THB',
      'IDR',
      'MYR',
      'PHP',
      'VND',
      'TWD',
      'SAR',
      'AED',
      'QAR',
      'KWD',
      'BHD',
      'OMR',
      'ILS',
    ]);
    const nonCryptoCommodities = new Set(['XAU', 'XAG', 'XTI', 'XBR']);

    if (fiatBases.has(base) || nonCryptoCommodities.has(base)) return false;
    return base.length >= 2 && base.length <= 10;
  }

  return false;
};

const normalizeSignalSymbol = (symbol) => normalizeUpper(symbol);

const normalizeSignalSegment = (segment, symbol = '') => {
  if (isCryptoLikeSymbol(symbol)) return 'CRYPTO';

  const seg = normalizeUpper(segment);
  if (!seg) return seg;

  if (['FO', 'FNO', 'NSEFO', 'NSE_FO', 'NSE-FNO', 'NSE-F&O', 'OPTIONS'].includes(seg)) return 'NFO';
  if (['CM', 'EQUITY'].includes(seg)) return 'NSE';
  if (['CUR', 'FX', 'FOREX'].includes(seg)) return 'CURRENCY';
  if (['BINANCE', 'CRYPTO'].includes(seg)) return 'CRYPTO';
  if (seg === 'COMMODITY') return 'MCX';

  return seg;
};

const buildWebhookSignalId = ({
  webhookId,
  symbol,
  segment,
  tradeType,
  timeframe,
  entryPrice,
  signalTime,
}) => {
  const providedId = String(webhookId || '').trim();
  return [
    'ENTRY',
    providedId,
    normalizeSignalSymbol(symbol),
    normalizeSignalSegment(segment, symbol),
    normalizeUpper(tradeType),
    String(timeframe || '').trim(),
    entryPrice !== undefined && entryPrice !== null ? String(entryPrice) : '',
    String(signalTime || '').trim(),
  ].join('|');
};

const getSignalAudienceGroups = (signalLike = {}) => {
  const groups = new Set();
  const category = normalizeUpper(signalLike.category);
  const segment = normalizeSignalSegment(signalLike.segment, signalLike.symbol);

  if (category === 'CRYPTO' || segment === 'CRYPTO') groups.add('CRYPTO');
  if (['MCX_FUT'].includes(category) || ['MCX', 'COMMODITY', 'COMEX', 'NYMEX'].includes(segment)) {
    groups.add('COMMODITY');
  }
  if (category === 'CURRENCY' || ['CURRENCY', 'CDS', 'BCD', 'FOREX'].includes(segment)) groups.add('CURRENCY');
  if (
    ['NIFTY_OPT', 'BANKNIFTY_OPT', 'FINNIFTY_OPT', 'STOCK_OPT'].includes(category) ||
    ['NFO', 'FNO', 'FO', 'OPTIONS', 'INDICES'].includes(segment)
  ) {
    groups.add('FNO');
  }
  if (
    ['EQUITY_INTRA', 'EQUITY_DELIVERY', 'BTST', 'HERO_ZERO'].includes(category) ||
    ['NSE', 'BSE', 'EQ', 'EQUITY'].includes(segment)
  ) {
    groups.add('EQUITY');
  }

  return Array.from(groups);
};

const mapPreferredSegmentsToAudienceGroups = (preferredSegments = []) => {
  const mapping = {
    ALL: ['ALL'],
    NSE: ['EQUITY'],
    BSE: ['EQUITY'],
    EQUITY: ['EQUITY'],
    OPTION: ['FNO'],
    OPTIONS: ['FNO'],
    FNO: ['FNO'],
    MCX: ['COMMODITY'],
    COMMODITY: ['COMMODITY'],
    COMEX: ['COMMODITY'],
    FOREX: ['CURRENCY'],
    CURRENCY: ['CURRENCY'],
    CRYPTO: ['CRYPTO'],
  };

  return Array.from(
    new Set(
      (Array.isArray(preferredSegments) ? preferredSegments : []).flatMap((segment) => {
        const key = normalizeUpper(segment);
        return mapping[key] || [];
      })
    )
  );
};

const mapUserSubscriptionSegmentsToAudienceGroups = (segments = []) => {
  const mapping = {
    EQUITY: ['EQUITY'],
    OPTIONS: ['FNO'],
    FNO: ['FNO'],
    COMMODITY: ['COMMODITY'],
    COMEX: ['COMMODITY'],
    FOREX: ['CURRENCY'],
    CURRENCY: ['CURRENCY'],
    CRYPTO: ['CRYPTO'],
    ALL: ['ALL'],
  };

  return Array.from(
    new Set(
      (Array.isArray(segments) ? segments : []).flatMap((segment) => {
        const key = normalizeUpper(segment);
        return mapping[key] || [];
      })
    )
  );
};

const hasAudienceOverlap = (left = [], right = []) => {
  const leftSet = new Set(Array.isArray(left) ? left : []);
  const rightSet = new Set(Array.isArray(right) ? right : []);

  if (leftSet.has('ALL') || rightSet.has('ALL')) return true;

  for (const value of leftSet) {
    if (rightSet.has(value)) return true;
  }

  return false;
};

export {
  buildWebhookSignalId,
  getSignalAudienceGroups,
  hasAudienceOverlap,
  isCryptoLikeSymbol,
  mapPreferredSegmentsToAudienceGroups,
  mapUserSubscriptionSegmentsToAudienceGroups,
  normalizeSignalSegment,
  normalizeSignalSymbol,
};

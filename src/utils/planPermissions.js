const ALL_PLAN_PERMISSIONS = [
  'EQUITY_INTRA',
  'EQUITY_DELIVERY',
  'NIFTY_OPT',
  'BANKNIFTY_OPT',
  'FINNIFTY_OPT',
  'STOCK_OPT',
  'MCX_FUT',
  'CURRENCY',
  'CRYPTO',
  'BTST',
  'HERO_ZERO',
];

const PERMISSION_SET = new Set(ALL_PLAN_PERMISSIONS);

const SEGMENT_PERMISSION_MAP = {
  ALL: ALL_PLAN_PERMISSIONS,
  EQUITY: ['EQUITY_INTRA', 'EQUITY_DELIVERY'],
  FNO: ['NIFTY_OPT', 'BANKNIFTY_OPT', 'FINNIFTY_OPT', 'STOCK_OPT'],
  OPTIONS: ['NIFTY_OPT', 'BANKNIFTY_OPT', 'FINNIFTY_OPT', 'STOCK_OPT'],
  COMMODITY: ['MCX_FUT'],
  MCX: ['MCX_FUT'],
  CURRENCY: ['CURRENCY'],
  FOREX: ['CURRENCY'],
  CRYPTO: ['CRYPTO'],
};

const FEATURE_PERMISSION_MAP = new Map([
  ['INTRADAY EQUITY', ['EQUITY_INTRA']],
  ['DELIVERY / SWING', ['EQUITY_DELIVERY']],
  ['NIFTY OPTIONS', ['NIFTY_OPT']],
  ['BANKNIFTY OPTIONS', ['BANKNIFTY_OPT']],
  ['FINNIFTY OPTIONS', ['FINNIFTY_OPT']],
  ['STOCK OPTIONS', ['STOCK_OPT']],
  ['MCX FUTURES', ['MCX_FUT']],
  ['CURRENCY', ['CURRENCY']],
  ['CRYPTO', ['CRYPTO']],
  ['COMMODITY', ['MCX_FUT']],
  ['FOREX', ['CURRENCY']],
  ['BTST CALLS', ['BTST']],
  ['HERO ZERO TRADES', ['HERO_ZERO']],
]);

const ALL_ACCESS_MARKERS = [
  'ACCESS TO ALL MARKET SEGMENTS',
  'ALL MARKET SEGMENTS INCLUDED',
  'ALL MARKET SEGMENTS',
  'ALL MARKET ACCESS',
  'COMPLETE MARKET ACCESS',
  'ALL SEGMENTS INCLUDED',
  'ALL SEGMENTS',
];

const normalizeValue = (value = '') => String(value || '').trim().toUpperCase();

const toUniquePermissions = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => normalizeValue(value))
        .filter((value) => PERMISSION_SET.has(value))
    )
  );

const mapSegmentsToPermissions = (segments = []) =>
  Array.from(
    new Set(
      (Array.isArray(segments) ? segments : [segments]).flatMap((segment) => {
        const normalized = normalizeValue(segment);
        return SEGMENT_PERMISSION_MAP[normalized] || [];
      })
    )
  );

const mapTextsToPermissions = (values = []) => {
  const permissions = new Set();

  for (const value of Array.isArray(values) ? values : [values]) {
    const normalized = normalizeValue(value);
    if (!normalized) continue;

    if (ALL_ACCESS_MARKERS.some((marker) => normalized.includes(marker))) {
      ALL_PLAN_PERMISSIONS.forEach((permission) => permissions.add(permission));
      continue;
    }

    for (const [marker, mappedPermissions] of FEATURE_PERMISSION_MAP.entries()) {
      if (!normalized.includes(marker)) continue;
      mappedPermissions.forEach((permission) => permissions.add(permission));
    }
  }

  return Array.from(permissions);
};

const derivePlanPermissions = (planLike = {}) => {
  const explicitPermissions = toUniquePermissions(planLike.permissions);
  if (explicitPermissions.length > 0) {
    return explicitPermissions;
  }

  return toUniquePermissions([
    ...mapTextsToPermissions(planLike.features),
    ...mapTextsToPermissions([planLike.name, planLike.description]),
    ...mapSegmentsToPermissions(planLike.segment),
  ]);
};

export {
  ALL_PLAN_PERMISSIONS,
  derivePlanPermissions,
  mapSegmentsToPermissions,
};

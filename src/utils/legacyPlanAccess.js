const normalizeLegacyPlanName = (planName = '') => String(planName || '').trim().toUpperCase();

const getLegacyPlanPermissions = (planName = '') => {
  const normalized = normalizeLegacyPlanName(planName);
  if (!normalized || normalized === 'FREE') return [];

  const permissions = new Set();

  if (normalized.includes('CRYPTO')) permissions.add('CRYPTO');
  if (normalized.includes('FOREX') || normalized.includes('CURRENCY')) permissions.add('CURRENCY');
  if (normalized.includes('COMMODITY')) {
    permissions.add('COMMODITY');
    permissions.add('MCX_FUT');
  }
  if (normalized.includes('EQUITY')) {
    permissions.add('EQUITY_INTRA');
    permissions.add('EQUITY_DELIVERY');
  }
  if (normalized.includes('OPTIONS') || normalized.includes('FNO')) {
    permissions.add('NIFTY_OPT');
    permissions.add('BANKNIFTY_OPT');
  }

  return Array.from(permissions);
};

const getLegacyPlanAudienceGroups = (planName = '') => {
  const permissions = new Set(getLegacyPlanPermissions(planName));
  const groups = new Set();

  if (permissions.has('EQUITY_INTRA') || permissions.has('EQUITY_DELIVERY')) groups.add('EQUITY');
  if (permissions.has('NIFTY_OPT') || permissions.has('BANKNIFTY_OPT')) groups.add('FNO');
  if (permissions.has('COMMODITY') || permissions.has('MCX_FUT')) groups.add('COMMODITY');
  if (permissions.has('CURRENCY')) groups.add('CURRENCY');
  if (permissions.has('CRYPTO')) groups.add('CRYPTO');

  return Array.from(groups);
};

export {
  getLegacyPlanAudienceGroups,
  getLegacyPlanPermissions,
};

const normalizeUpper = (value = '') => String(value || '').trim().toUpperCase();

const getAllowedAccessFromPermissions = (permissions = []) => {
  const perms = Array.isArray(permissions) ? permissions : [];
  const allowedSegments = [];
  const allowedCategories = [];

  if (perms.includes('COMMODITY') || perms.includes('MCX_FUT')) {
    allowedSegments.push('COMMODITY', 'COMEX', 'MCX');
    allowedCategories.push('MCX_FUT');
  }
  if (perms.includes('EQUITY_INTRA') || perms.includes('EQUITY_DELIVERY')) {
    allowedSegments.push('EQUITY', 'NSE', 'BSE');
    allowedCategories.push('EQUITY_INTRA', 'EQUITY_DELIVERY');
  }
  if (
    perms.includes('NIFTY_OPT') ||
    perms.includes('BANKNIFTY_OPT') ||
    perms.includes('FINNIFTY_OPT') ||
    perms.includes('STOCK_OPT')
  ) {
    allowedSegments.push('FNO', 'NFO', 'CDS');
    allowedCategories.push('NIFTY_OPT', 'BANKNIFTY_OPT', 'STOCK_OPT', 'FINNIFTY_OPT');
  }
  if (perms.includes('CURRENCY')) {
    allowedSegments.push('CURRENCY', 'CDS', 'BCD');
    allowedCategories.push('CURRENCY');
  }
  if (perms.includes('CRYPTO')) {
    allowedSegments.push('CRYPTO');
    allowedCategories.push('CRYPTO');
  }
  if (perms.includes('BTST')) {
    allowedSegments.push('EQUITY', 'NSE', 'BSE');
    allowedCategories.push('BTST');
  }
  if (perms.includes('HERO_ZERO')) {
    allowedSegments.push('EQUITY', 'NSE', 'BSE');
    allowedCategories.push('HERO_ZERO');
  }

  return { allowedSegments, allowedCategories };
};

const getPlanStatusFromPlanData = (planData = {}, now = new Date()) => {
  const permissions = Array.isArray(planData?.permissions) ? planData.permissions : [];
  const planExpiry = planData?.planExpiry ? new Date(planData.planExpiry) : null;
  const planExpiryValid = planExpiry instanceof Date && !Number.isNaN(planExpiry.getTime());
  const isActiveByExpiry = planExpiryValid && planExpiry > now;
  const hasPlanId = Boolean(planData?.planId);

  return isActiveByExpiry || permissions.length > 0 || (hasPlanId && !planExpiryValid)
    ? 'active'
    : 'expired';
};

const hasSignalAccessByPermissions = (signal = {}, permissions = []) => {
  if (signal?.isFree) return true;

  const { allowedSegments, allowedCategories } = getAllowedAccessFromPermissions(permissions);
  const normalizedSegment = normalizeUpper(signal?.segment);
  const normalizedCategory = normalizeUpper(signal?.category);

  if (
    (normalizedSegment && allowedSegments.includes(normalizedSegment)) ||
    (normalizedCategory && allowedCategories.includes(normalizedCategory))
  ) {
    return true;
  }

  // Fail safe: if signal metadata is incomplete, never broaden access.
  return false;
};

const hasSignalAccessByPlan = (signal = {}, planData = {}, now = new Date()) => {
  if (signal?.isFree) return true;
  if (getPlanStatusFromPlanData(planData, now) !== 'active') return false;
  return hasSignalAccessByPermissions(signal, planData?.permissions || []);
};

export {
  getAllowedAccessFromPermissions,
  getPlanStatusFromPlanData,
  hasSignalAccessByPermissions,
  hasSignalAccessByPlan,
};

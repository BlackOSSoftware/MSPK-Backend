import Plan from '../models/Plan.js';
import ApiError from '../utils/ApiError.js';
import httpStatus from 'http-status';

const mapFeaturesToPermissions = (features) => {
  if (!features || !Array.isArray(features)) return [];
  const mapping = {
    'Intraday Equity': 'EQUITY_INTRA',
    'Delivery / Swing': 'EQUITY_DELIVERY',
    'Nifty Options': 'NIFTY_OPT',
    'BankNifty Options': 'BANKNIFTY_OPT',
    'FinNifty Options': 'FINNIFTY_OPT',
    'Stock Options': 'STOCK_OPT',
    'MCX Futures': 'MCX_FUT',
    'Currency': 'CURRENCY',
    'Crypto': 'CRYPTO',
    'Commodity': 'MCX_FUT', // Fallback
    'Forex': 'CURRENCY'    // Fallback
  };
  
  // Filter and map valid permissions
  const perms = new Set();
  features.forEach(f => {
    if (mapping[f]) perms.add(mapping[f]);
    // Also check if feature IS already a permission key (for direct API usage)
    if (Object.values(mapping).includes(f)) perms.add(f);
  });
  
  return Array.from(perms);
};

const createPlan = async (planBody) => {
  // Auto-map permissions from features (Admin Panel Compat)
  if (planBody.features && (!planBody.permissions || planBody.permissions.length === 0)) {
      planBody.permissions = mapFeaturesToPermissions(planBody.features);
  }
  return Plan.create(planBody);
};

const queryPlans = async (filter, options) => {
  const plans = await Plan.find(filter);
  return plans;
};

const getPlanById = async (id) => {
  return Plan.findById(id);
};

const updatePlanById = async (planId, updateBody) => {
  const plan = await getPlanById(planId);
  if (!plan) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found');
  }
  
  // Auto-map permissions on update too
  if (updateBody.features) {
      updateBody.permissions = mapFeaturesToPermissions(updateBody.features);
  }
  
  Object.assign(plan, updateBody);
  await plan.save();
  return plan;
};

const deletePlanById = async (planId) => {
  const plan = await getPlanById(planId);
  if (!plan) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found');
  }
  await plan.deleteOne();
  return plan;
};

export default {
  createPlan,
  queryPlans,
  getPlanById,
  updatePlanById,
  deletePlanById,
};

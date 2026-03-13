import Plan from '../models/Plan.js';
import ApiError from '../utils/ApiError.js';
import httpStatus from 'http-status';
import { derivePlanPermissions } from '../utils/planPermissions.js';

const normalizeSegments = (value) => {
  const rawValues = Array.isArray(value) ? value : [value];
  const normalized = rawValues
    .map((item) => String(item || '').trim().toUpperCase())
    .filter(Boolean);

  if (normalized.includes('ALL')) {
    return ['ALL'];
  }

  return Array.from(new Set(normalized));
};

const normalizePlanPayload = (planBody = {}) => {
  const payload = { ...planBody };
  const resolvedSegments = normalizeSegments(payload.segments?.length ? payload.segments : payload.segment);

  if (resolvedSegments.length > 0) {
    payload.segments = resolvedSegments;
    payload.segment = payload.segment
      ? String(payload.segment).trim().toUpperCase()
      : resolvedSegments[0];
  } else {
    delete payload.segments;
    if (payload.segment) {
      payload.segment = String(payload.segment).trim().toUpperCase();
    }
  }

  if (typeof payload.description === 'string') {
    payload.description = payload.description.trim();
  }

  return payload;
};

const createPlan = async (planBody) => {
  const normalizedBody = normalizePlanPayload(planBody);
  const resolvedPermissions = derivePlanPermissions(normalizedBody);
  if (resolvedPermissions.length > 0) {
      normalizedBody.permissions = resolvedPermissions;
  }
  return Plan.create(normalizedBody);
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

  const normalizedUpdateBody = normalizePlanPayload(updateBody);
  const resolvedPermissions = derivePlanPermissions({
    ...plan.toObject(),
    ...normalizedUpdateBody,
  });
  normalizedUpdateBody.permissions = resolvedPermissions;
  
  Object.assign(plan, normalizedUpdateBody);
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

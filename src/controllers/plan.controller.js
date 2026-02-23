import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import { planService } from '../services/index.js';
import ApiError from '../utils/ApiError.js';

const createPlan = catchAsync(async (req, res) => {
  const plan = await planService.createPlan(req.body);
  res.status(httpStatus.CREATED).send(plan);
});

const getPlans = catchAsync(async (req, res) => {
  const filter = { isActive: true };
  // Check if user is admin (req.user is set by auth middleware)
  if (req.user && req.user.role === 'admin') {
      delete filter.isActive;
  }
  const plans = await planService.queryPlans(filter);
  res.send(plans);
});

const getPlan = catchAsync(async (req, res) => {
  const plan = await planService.getPlanById(req.params.planId);
  if (!plan) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found');
  }
  res.send(plan);
});

const updatePlan = catchAsync(async (req, res) => {
  const plan = await planService.updatePlanById(req.params.planId, req.body);
  res.send(plan);
});



const deletePlan = catchAsync(async (req, res) => {
  // Safe Deletion Check
  const Subscription = (await import('../models/Subscription.js')).default;
  const activeSubs = await Subscription.countDocuments({ plan: req.params.planId, status: 'active' });
  
  if (activeSubs > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Cannot delete plan. It has ${activeSubs} active subscribers.`);
  }

  await planService.deletePlanById(req.params.planId);
  res.status(httpStatus.NO_CONTENT).send();
});

export default {
  createPlan,
  getPlans,
  getPlan,
  updatePlan,
  deletePlan,
};

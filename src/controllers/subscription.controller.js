import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import subscriptionService from '../services/subscription.service.js';

// GET /api/segments
const getSegments = catchAsync(async (req, res) => {
  const segments = await subscriptionService.getAllSegments();
  res.send(segments);
});

// GET /api/subscriptions/admin/all
const getAllSubscriptions = catchAsync(async (req, res) => {
  const subscriptions = await subscriptionService.getAllSubscriptions();
  res.send(subscriptions);
});

// POST /api/subscribe/purchase
// Body: { segments: ['EQUITY', 'FNO'], planType: 'premium' }
const purchase = catchAsync(async (req, res) => {
  const { segments, planType } = req.body;
  const user = req.user; // Assumes auth middleware populates req.user

  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return res.status(httpStatus.BAD_REQUEST).send({ message: 'Segments array is required' });
  }

  const subscription = await subscriptionService.purchaseSegments(user.id, segments, planType);
  res.status(httpStatus.CREATED).send(subscription);
});

// GET /api/subscribe/status
const getStatus = catchAsync(async (req, res) => {
  const status = await subscriptionService.getSubscriptionStatus(req.user.id);
  res.send({ hasActiveSubscription: !!status, subscription: status });
});

// GET /api/subscribe/has-access/:segment
const checkAccess = catchAsync(async (req, res) => {
  const { segment } = req.params;
  const hasAccess = await subscriptionService.checkAccess(req.user.id, segment.toUpperCase());
  res.send({ segment, hasAccess });
});

export default {
  getSegments,
  getAllSubscriptions,
  purchase,
  getStatus,
  checkAccess
};

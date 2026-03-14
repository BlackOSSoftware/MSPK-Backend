import httpStatus from 'http-status';
import PlanEnquiry from '../models/PlanEnquiry.js';
import catchAsync from '../utils/catchAsync.js';

const resolveIpAddress = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '';
};

const createPlanEnquiry = catchAsync(async (req, res) => {
  const user = req.user || null;
  const body = req.body || {};
  const source = body.source === 'dashboard' ? 'dashboard' : 'public_website';
  const resolvedName = String(user?.name || body.userName || '').trim();
  const resolvedEmail = String(user?.email || body.userEmail || '').trim().toLowerCase();

  const enquiry = await PlanEnquiry.create({
    planId: body.planId || '',
    planName: body.planName || 'Unknown Plan',
    planPriceLabel: body.planPriceLabel || '',
    planDurationLabel: body.planDurationLabel || '',
    planSegment: body.planSegment || '',
    source,
    sourcePage: body.sourcePage || '',
    pageUrl: body.pageUrl || '',
    referrerUrl: body.referrerUrl || '',
    visitorId: body.visitorId || '',
    user: user?._id || undefined,
    userName: resolvedName,
    userEmail: resolvedEmail,
    userPhone: user?.phone || body.userPhone || '',
    clientId: user?.clientId || body.clientId || '',
    googleAccountEmail: body.googleAccountEmail || '',
    browserName: body.browserName || '',
    browserVersion: body.browserVersion || '',
    osName: body.osName || '',
    deviceType: body.deviceType || '',
    platform: body.platform || '',
    language: body.language || '',
    userAgent: body.userAgent || req.headers['user-agent'] || '',
    ipAddress: resolveIpAddress(req),
  });

  res.status(httpStatus.CREATED).send(enquiry);
});

const getPlanEnquiries = catchAsync(async (req, res) => {
  const results = await PlanEnquiry.find({})
    .populate('user', 'name email phone clientId')
    .sort({ createdAt: -1 })
    .lean();

  const stats = {
    total: results.length,
    new: results.filter((item) => item.status === 'new').length,
    reviewed: results.filter((item) => item.status === 'reviewed').length,
    closed: results.filter((item) => item.status === 'closed').length,
    dashboard: results.filter((item) => item.source === 'dashboard').length,
    publicWebsite: results.filter((item) => item.source === 'public_website').length,
  };

  res.send({ results, stats });
});

const updatePlanEnquiryStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const status = String(req.body?.status || '').trim().toLowerCase();
  const allowedStatuses = new Set(['new', 'reviewed', 'closed']);

  if (!allowedStatuses.has(status)) {
    return res.status(httpStatus.BAD_REQUEST).send({ message: 'Invalid status' });
  }

  const updateBody = {
    status,
  };

  if (status === 'reviewed') {
    updateBody.reviewedAt = new Date();
  }

  if (status === 'closed') {
    updateBody.closedAt = new Date();
    if (!updateBody.reviewedAt) {
      updateBody.reviewedAt = new Date();
    }
  }

  if (typeof req.body?.notes === 'string') {
    updateBody.notes = req.body.notes.trim();
  }

  const enquiry = await PlanEnquiry.findByIdAndUpdate(id, updateBody, { new: true });
  if (!enquiry) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Plan enquiry not found' });
  }

  res.send(enquiry);
});

export default {
  createPlanEnquiry,
  getPlanEnquiries,
  updatePlanEnquiryStatus,
};

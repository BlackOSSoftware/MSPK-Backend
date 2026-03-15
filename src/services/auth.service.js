import httpStatus from 'http-status';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import subscriptionService from './subscription.service.js';
import { derivePlanPermissions, mapSegmentsToPermissions } from '../utils/planPermissions.js';

const createUser = async (userBody) => {
  if (await User.findOne({ email: userBody.email })) {
    throw new ApiError(400, 'Email already taken');
  }

  // Handle Referral Logic
  const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase(); // Simple 6-char code
  
  let referredBy = undefined;
  if (userBody.referralCode) {
      const referrer = await User.findOne({ 'referral.code': userBody.referralCode });
      if (referrer) {
          referredBy = referrer._id;
      }
  }

  const preferredSegmentMap = {
      NSE: 'NSE',
      ALL: 'ALL',
      OPTION: 'OPTIONS',
      OPTIONS: 'OPTIONS',
      MCX: 'MCX',
      COMEX: 'MCX',
      FOREX: 'FOREX',
      CRYPTO: 'CRYPTO',
      EQUITY: 'NSE',
      COMMODITY: 'MCX'
  };

  const subscriptionSegmentMap = {
      NSE: ['EQUITY'],
      ALL: ['EQUITY', 'OPTIONS', 'COMMODITY', 'FOREX', 'CRYPTO'],
      OPTION: ['OPTIONS'],
      OPTIONS: ['OPTIONS'],
      MCX: ['COMMODITY'],
      COMEX: ['COMMODITY'],
      FOREX: ['FOREX'],
      CRYPTO: ['CRYPTO'],
      EQUITY: ['EQUITY'],
      COMMODITY: ['COMMODITY']
  };

  const normalizePreferredSegments = (segments) => {
      if (!Array.isArray(segments)) return [];
      const normalized = segments
          .map(s => preferredSegmentMap[String(s || '').trim().toUpperCase()])
          .filter(Boolean);
      return Array.from(new Set(normalized));
  };

  const normalizeSubscriptionSegments = (segments) => {
      if (!Array.isArray(segments)) return [];
      const normalized = segments.flatMap((segment) => {
          const key = String(segment || '').trim().toUpperCase();
          return subscriptionSegmentMap[key] || [];
      });
      return Array.from(new Set(normalized));
  };

  const { city, segments, preferredSegments, ...restBody } = userBody;
  const rawSegments = [
      ...(Array.isArray(segments) ? segments : []),
      ...(Array.isArray(preferredSegments) ? preferredSegments : [])
  ];

  const profile = { ...(restBody.profile || {}) };
  if (city && !profile.city) {
      profile.city = city;
  }
  let user;
  try {
      user = await User.create({
          ...restBody,
          profile,
          preferredSegments: normalizePreferredSegments(rawSegments),
          referral: {
              code: referralCode,
              referredBy: referredBy
          },
          status: 'Active'
      });

      const demoSegments = normalizeSubscriptionSegments(rawSegments);
      if (demoSegments.length > 0) {
          await subscriptionService.purchaseSegments(user.id, demoSegments, 'demo');
      }
      return user;
  } catch (error) {
      if (user?._id) {
          await User.deleteOne({ _id: user._id });
      }
      throw error;
  }
};

const loginUserWithEmailAndPassword = async (email, password) => {
  // Ensure email is lowercase to match schema
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !(await user.matchPassword(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
  }

  // Strict Login Check: Email Verification
  if (!user.isEmailVerified) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Email is not verified. Please verify your email to continue.');
  }

  // Strict Login Check: Account Status
  if (user.status !== 'Active') {
    throw new ApiError(httpStatus.FORBIDDEN, `Your account is ${user.status.toLowerCase()}. Please contact support.`);
  }

  // Return both the Mongoose Document (for saving) and the Plan Data (for response)
  const planDetails = await getUserActivePlan(user);
  return { user, planDetails };
};

const getUserActivePlan = async (user) => {
  const Subscription = (await import('../models/Subscription.js')).default;
  
  // 1. Check New Subscription Model
  const now = new Date();
  const activeSubs = await Subscription.find({ 
      user: user._id, 
      status: 'active', 
      startDate: { $lte: now },
      endDate: { $gt: now } 
  }).populate('plan');

  if (activeSubs && activeSubs.length > 0) {
      const allPermissions = new Set();
      let latestExpiry = activeSubs[0].endDate;
      const planNames = [];

      activeSubs.forEach(sub => {
          if (sub.plan) {
              planNames.push(sub.plan.name);
              derivePlanPermissions(sub.plan).forEach((permission) => allPermissions.add(permission));
              if (sub.endDate > latestExpiry) {
                  latestExpiry = sub.endDate;
              }
          }
      });

      return {
          planId: activeSubs[0].plan._id,
          planName: planNames.join(' + '),
          permissions: Array.from(allPermissions),
          planExpiry: latestExpiry
      };
  }

  // 2. Check Segment-based Subscription Model (UserSubscription)
  const UserSubscription = (await import('../models/UserSubscription.js')).default;
  const activeSegmentSub = await UserSubscription.findOne({
      user_id: user._id,
      status: 'active',
      is_active: true,
      end_date: { $gt: new Date() }
  }).sort({ end_date: -1 });

  if (activeSegmentSub) {
      const segments = Array.isArray(activeSegmentSub.segments) ? activeSegmentSub.segments : [];

      return {
          planId: 'segments',
          planName: segments.join(' + ') || 'Segments',
          permissions: mapSegmentsToPermissions(segments),
          planExpiry: activeSegmentSub.end_date
      };
  }

  // 3. Fallback to Legacy User.subscription (for Converted Leads / Old Users)
  if (user.subscription && user.subscription.plan && user.subscription.plan !== 'free') {
      const now = new Date();
      const expiry = user.subscription.expiresAt ? new Date(user.subscription.expiresAt) : null;
      
      if (!expiry || expiry > now) {
          const legacyPlan = user.subscription.plan.toUpperCase();
          const permissions = [];
          
          if (legacyPlan.includes('CRYPTO')) permissions.push('CRYPTO');
          if (legacyPlan.includes('FOREX') || legacyPlan.includes('CURRENCY')) permissions.push('CURRENCY');
          if (legacyPlan.includes('COMMODITY')) permissions.push('COMMODITY', 'MCX_FUT');
          if (legacyPlan.includes('EQUITY')) permissions.push('EQUITY_INTRA', 'EQUITY_DELIVERY');
          if (legacyPlan.includes('OPTIONS') || legacyPlan.includes('FNO')) permissions.push('NIFTY_OPT', 'BANKNIFTY_OPT');

          return {
              planId: 'legacy',
              planName: user.subscription.plan,
              permissions: permissions,
              planExpiry: expiry
          };
      }
  }
  
  return {
      permissions: [],
      planName: 'Expired',
      planId: null,
      planExpiry: null
  };
};

const getSegmentsFromPermissions = (permissions) => {
  const mapping = {
      'EQUITY_INTRA': ['EQUITY'],
      'EQUITY_DELIVERY': ['EQUITY'],
      'NIFTY_OPT': ['FNO'],
      'BANKNIFTY_OPT': ['FNO'],
      'FINNIFTY_OPT': ['FNO'],
      'STOCK_OPT': ['FNO'],
      'MCX_FUT': ['COMMODITY'],
      'CURRENCY': ['CURRENCY'],
      'CRYPTO': ['CRYPTO']
  };
  const segments = new Set();
  if (Array.isArray(permissions)) {
    permissions.forEach(p => {
        if (mapping[p]) {
            mapping[p].forEach(s => segments.add(s));
        }
    });
  }
  return Array.from(segments);
};

export default {
  createUser,
  loginUserWithEmailAndPassword,
  getUserActivePlan,
  getSegmentsFromPermissions
};

import httpStatus from 'http-status';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';

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

  const user = await User.create({
      ...userBody,
      referral: {
          code: referralCode,
          referredBy: referredBy
      },
      status: 'Active'
  });
  return user;
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
  const activeSubs = await Subscription.find({ 
      user: user._id, 
      status: 'active', 
      endDate: { $gt: new Date() } 
  }).populate('plan');

  if (activeSubs && activeSubs.length > 0) {
      const allPermissions = new Set();
      let latestExpiry = activeSubs[0].endDate;
      const planNames = [];

      activeSubs.forEach(sub => {
          if (sub.plan) {
              planNames.push(sub.plan.name);
              if (sub.plan.permissions) {
                  sub.plan.permissions.forEach(p => allPermissions.add(p));
              }
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
      const permissions = new Set();

      segments.forEach(seg => {
          const s = String(seg || '').toUpperCase();
          if (s === 'EQUITY') {
              permissions.add('EQUITY_INTRA');
              permissions.add('EQUITY_DELIVERY');
          }
          if (s === 'CRYPTO') {
              permissions.add('CRYPTO');
          }
          if (s === 'COMMODITY') {
              permissions.add('MCX_FUT');
          }
          if (s === 'FOREX') {
              permissions.add('CURRENCY');
          }
          if (s === 'OPTIONS') {
              permissions.add('NIFTY_OPT');
              permissions.add('BANKNIFTY_OPT');
              permissions.add('FINNIFTY_OPT');
              permissions.add('STOCK_OPT');
          }
      });

      return {
          planId: 'segments',
          planName: segments.join(' + ') || 'Segments',
          permissions: Array.from(permissions),
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

import Segment from '../models/Segment.js';
import UserSubscription from '../models/UserSubscription.js';
import AdminSetting from '../models/AdminSetting.js';
import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';

// --- Core Service Functions ---

/**
 * Get all active segments
 * @returns {Promise<Array>}
 */
const getAllSegments = async () => {
  return Segment.find({ is_active: true }).select('segment_code name base_price');
};

/**
 * Get all subscriptions (Admin)
 * @returns {Promise<Array>}
 */
const getAllSubscriptions = async () => {
  return UserSubscription.find()
    .populate('user_id', 'name email mobile')
    .sort({ createdAt: -1 });
};

/**
 * Purchase Segments
 * @param {string} userId - User ID
 * @param {Array<string>} segmentCodes - List of requested segments
 * @param {string} planType - 'demo' or 'premium'
 * @returns {Promise<Object>} - Subscription details
 */
const purchaseSegments = async (userId, segmentCodes, planType = 'premium') => {
  // 1. Validation: Maximum 1 segment for Demo
  if (planType === 'demo' && segmentCodes.length > 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Demo plan allows maximum 1 segment.');
  }

  // 2. Validate Segments & Calculate Price
  const validSegments = await Segment.find({ 
    segment_code: { $in: segmentCodes },
    is_active: true
  });

  if (validSegments.length !== segmentCodes.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'One or more invalid or inactive segments selected.');
  }

  // 3. Simple Sum (No Discounts)
  const totalAmount = planType === 'demo' 
    ? 0 
    : validSegments.reduce((sum, seg) => sum + seg.base_price, 0);

  // 4. Determine Validity
  let settings = await AdminSetting.findOne();
  if (!settings) {
    // Creating default if missing
    settings = await AdminSetting.create({ demo_validity_days: 1, premium_validity_days: 30 });
  }

  const validityDays = planType === 'demo' ? settings.demo_validity_days : settings.premium_validity_days;
  
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(startDate.getDate() + validityDays);

  // 5. Create Subscription
  // Note: We expire previous active subscriptions for simplicity as per "fresh start" 
  // or we could append. Requirement says "User multiple segments purchase kar sake".
  // Simplest approach: Deactivate old active ones, create new one.
  await UserSubscription.updateMany(
    { user_id: userId, status: 'active' },
    { status: 'cancelled', is_active: false }
  );

  const subscription = await UserSubscription.create({
    user_id: userId,
    segments: segmentCodes,
    total_amount: totalAmount,
    start_date: startDate,
    end_date: endDate,
    plan_type: planType,
    status: 'active'
  });

  return subscription;
};

/**
 * Check User Subscription Status (Full Details)
 * @param {string} userId
 */
const getSubscriptionStatus = async (userId) => {
  const sub = await UserSubscription.findOne({ 
    user_id: userId, 
    status: 'active', 
    end_date: { $gt: new Date() } 
  });
  return sub || null;
};

/**
 * CORE ACCESS CHECK LOGIC
 * @param {string} userId 
 * @param {string} segmentCode 
 * @returns {Promise<boolean>}
 */
const checkAccess = async (userId, segmentCode) => {
  // 1. Find ACTIVE subscription for this user
  // 2. Check if not expired
  // 3. Check if segment exists in array
  const count = await UserSubscription.countDocuments({
    user_id: userId,
    status: 'active',
    end_date: { $gt: new Date() }, // Not expired
    segments: segmentCode // Mongoose array queries check for existence
  });

  return count > 0;
};

// --- Seed Helper (Optional, for first run) ---
const seedDefaults = async () => {
    const count = await Segment.countDocuments();
    if (count === 0) {
        const defaults = [
            { segment_code: 'EQUITY', name: 'Equity Trading', base_price: 25000 },
            { segment_code: 'CRYPTO', name: 'Crypto Trading', base_price: 25000 },
            { segment_code: 'COMMODITY', name: 'Commodity Trading', base_price: 25000 },
            { segment_code: 'FOREX', name: 'Forex Trading', base_price: 25000 },
            { segment_code: 'OPTIONS', name: 'Options Trading', base_price: 25000 },
        ];
        await Segment.insertMany(defaults);
        console.log('Default segments seeded');
    }
};

export default {
  getAllSegments,
  getAllSubscriptions,
  purchaseSegments,
  getSubscriptionStatus,
  checkAccess,
  seedDefaults
};

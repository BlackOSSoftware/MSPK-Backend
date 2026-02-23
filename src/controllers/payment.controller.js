import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import AdminPaymentDetails from '../models/AdminPaymentDetails.js';
import UserSubscription from '../models/UserSubscription.js';
import Segment from '../models/Segment.js';
import AdminSetting from '../models/AdminSetting.js';
import ApiError from '../utils/ApiError.js';

// --- Admin Payment Details ---

const getPaymentDetails = catchAsync(async (req, res) => {
  let details = await AdminPaymentDetails.findOne();
  if (!details) {
      details = await AdminPaymentDetails.create({});
  }
  res.send(details);
});

const updatePaymentDetails = catchAsync(async (req, res) => {
  const body = req.body;
  if (req.file) {
      body.qrCodeUrl = req.file.path.replace(/\\/g, '/'); // Normalize path
  }
  
  let details = await AdminPaymentDetails.findOne();
  if (!details) {
      details = await AdminPaymentDetails.create(body);
  } else {
      Object.assign(details, body);
      await details.save();
  }
  res.send(details);
});

// --- Manual Verification Flow ---

const submitPayment = catchAsync(async (req, res) => {
    const { userId, segmentCodes, transactionId } = req.body;
    // req.body.segmentCodes might be stringified if coming from FormData
    const segments = typeof segmentCodes === 'string' ? JSON.parse(segmentCodes) : segmentCodes;

    if (!req.file) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Screenshot is required');
    }

    // 1. Validate segments exist
    const validSegments = await Segment.find({ segment_code: { $in: segments } });
    if (validSegments.length !== segments.length) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid segments selected');
    }

    // 2. Calculate Amount (For record keeping)
    const totalAmount = validSegments.reduce((sum, seg) => sum + seg.base_price, 0);

    // 3. Create Subscription with PENDING status
    // Note: We are creating a NEW subscription record.
    // If user has existing active one, this will coexist or replace?
    // User requested: "Payment Submitted! Waiting for Admin Approval."
    
    // We fetch checks logic from subscription service typically, but here we duplicate slightly for "Pending" logic
    // Validity will be decided when Admin APPROVES. 
    // So start/end date are tentative or null? Let's set start now, end now (expired) + valid flag false?
    // Better: status = 'pending_verification'.
    
    // Check allow enum in schema? We need to update UserSubscription enum first?
    // Let's check UserSubscription schema... it has ['active', 'expired', 'cancelled'].
    // We need to add 'pending'.

    const subscription = await UserSubscription.create({
        user_id: req.user.id,
        segments: segments,
        total_amount: totalAmount,
        start_date: new Date(),
        end_date: new Date(), // No validity yet
        plan_type: 'premium', // Manual payments are usually premium
        status: 'pending',    // <--- Need to update Enum
        is_active: false,
        // We need a place to store screenshot/transactionId. 
        // Schema update required? Yes.
        // For now, storing meta in a new field or hijacking an existing one?
        // Let's strictly update the schema in next step.
    });
    
    // Hack: We need to save screenshotUrl and txnId.
    // I will attach them to the subscription object if schema allows, or use a separate "PaymentRequest" model?
    // "Simple" -> Separate model is complex.
    // Better: Update UserSubscription to have `payment_meta` or similar.
    
    // FOR NOW, to allow progress, I will update UserSubscription schema in next step to include `payment_proof` and `transaction_id`.

    subscription.payment_proof = req.file.path.replace(/\\/g, '/'); // Add this field to schema
    subscription.transaction_id = transactionId;
    await subscription.save();

    res.status(httpStatus.CREATED).send({ message: 'Payment submitted for verification', subscription });
});

export default {
    getPaymentDetails,
    updatePaymentDetails,
    submitPayment
};

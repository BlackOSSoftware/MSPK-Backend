import mongoose from 'mongoose';

const userSubscriptionSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    segments: [{
      type: String,
      enum: ['EQUITY', 'CRYPTO', 'COMMODITY', 'FOREX', 'OPTIONS'],
      required: true
    }],
    total_amount: {
      type: Number,
      required: true,
      min: 0
    },
    start_date: {
      type: Date,
      default: Date.now,
      required: true
    },
    end_date: {
      type: Date,
      required: true,
      index: true // Key for expiration checks
    },
    plan_type: {
      type: String,
      enum: ['demo', 'premium'],
      required: true
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled', 'pending'],
      default: 'active',
      index: true
    },
    is_active: {
      type: Boolean,
      default: true
    },
    // Payment Verification Fields
    payment_proof: {
      type: String, // Path to screenshot
      default: null
    },
    transaction_id: {
      type: String,
      default: null
    },
    admin_note: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound index for frequent access checks: User + Status + Date
userSubscriptionSchema.index({ user_id: 1, status: 1, end_date: 1 });

const UserSubscription = mongoose.model('UserSubscription', userSubscriptionSchema);

export default UserSubscription;

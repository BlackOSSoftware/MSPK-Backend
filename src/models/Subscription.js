import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'canceled'],
      default: 'active',
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
      required: true,
    },
    preExpiryReminderSent: {
      type: Boolean,
      default: false,
    },
    expiryNotificationSent: {
      type: Boolean,
      default: false,
    },
    transaction: {
      type: mongoose.Schema.Types.ObjectId, // Link to Transaction
      ref: 'Transaction'
    },
    // paymentId deprecated, use transaction reference
  },
  {
    timestamps: true,
  }
);

const Subscription = mongoose.model('Subscription', subscriptionSchema);

export default Subscription;

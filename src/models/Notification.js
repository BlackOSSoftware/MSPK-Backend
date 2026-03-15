
import mongoose from 'mongoose';

const notificationSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: [
        'SYSTEM',
        'SIGNAL',
        'PAYMENT',
        'TICKET',
        'ANNOUNCEMENT',
        'SUBSCRIPTION_REMINDER',
        'SUBSCRIPTION_EXPIRY_REMINDER',
        'SUBSCRIPTION_EXPIRED',
        'DEMO_REMINDER',
        'ECONOMIC_ALERT',
        'REMINDER'
      ],
      default: 'SYSTEM',
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    data: {
      type: Object, // Optional payload (e.g. signalId, ticketId)
      default: {}
    },
    dedupKey: {
      type: String,
      trim: true,
    },
    link: {
      type: String, // Optional redirect URL
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ dedupKey: 1 }, { unique: true, sparse: true });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;

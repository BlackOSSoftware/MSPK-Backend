
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
      enum: ['SYSTEM', 'SIGNAL', 'PAYMENT', 'TICKET', 'ANNOUNCEMENT'],
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
    link: {
      type: String, // Optional redirect URL
    },
  },
  {
    timestamps: true,
  }
);

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;

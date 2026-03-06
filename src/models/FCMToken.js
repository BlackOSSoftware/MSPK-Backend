import mongoose from 'mongoose';

const fcmTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    platform: {
      type: String,
      enum: ['android', 'web', 'ios'],
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

const FCMToken = mongoose.model('FCMToken', fcmTokenSchema);

export default FCMToken;

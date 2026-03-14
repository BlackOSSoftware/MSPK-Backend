import mongoose from 'mongoose';

const planEnquirySchema = new mongoose.Schema(
  {
    planId: {
      type: String,
      trim: true,
    },
    planName: {
      type: String,
      trim: true,
      required: true,
    },
    planPriceLabel: {
      type: String,
      trim: true,
    },
    planDurationLabel: {
      type: String,
      trim: true,
    },
    planSegment: {
      type: String,
      trim: true,
    },
    source: {
      type: String,
      enum: ['dashboard', 'public_website'],
      required: true,
    },
    sourcePage: {
      type: String,
      trim: true,
    },
    pageUrl: {
      type: String,
      trim: true,
    },
    referrerUrl: {
      type: String,
      trim: true,
    },
    visitorId: {
      type: String,
      trim: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    userName: {
      type: String,
      trim: true,
    },
    userEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    userPhone: {
      type: String,
      trim: true,
    },
    clientId: {
      type: String,
      trim: true,
    },
    googleAccountEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    browserName: {
      type: String,
      trim: true,
    },
    browserVersion: {
      type: String,
      trim: true,
    },
    osName: {
      type: String,
      trim: true,
    },
    deviceType: {
      type: String,
      trim: true,
    },
    platform: {
      type: String,
      trim: true,
    },
    language: {
      type: String,
      trim: true,
    },
    userAgent: {
      type: String,
      trim: true,
    },
    ipAddress: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['new', 'reviewed', 'closed'],
      default: 'new',
    },
    reviewedAt: {
      type: Date,
    },
    closedAt: {
      type: Date,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

planEnquirySchema.index({ createdAt: -1 });
planEnquirySchema.index({ status: 1, createdAt: -1 });
planEnquirySchema.index({ source: 1, createdAt: -1 });

const PlanEnquiry = mongoose.model('PlanEnquiry', planEnquirySchema);

export default PlanEnquiry;

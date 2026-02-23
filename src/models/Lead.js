import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    password: { // Temp storage for auto-creation
      type: String,
      required: true,
      minlength: 6,
    },
    status: {
      type: String,
      enum: ['PENDING', 'CONTACTED', 'CONVERTED', 'REJECTED'],
      default: 'PENDING',
    },
    notes: {
      type: String,
    },
    city: { type: String },
    segment: { type: String },
    plan: { type: String },
    paymentScreenshot: { type: String }, // Path to file
    ipAddress: { type: String },
  },
  {
    timestamps: true,
  }
);

const Lead = mongoose.model('Lead', leadSchema);

export default Lead;

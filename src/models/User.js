import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
      private: true, // Custom option to indicate this shoudn't be returned by default
    },
    role: {
      type: String,
      enum: ['user', 'admin', 'sub-broker'],
      default: 'user',
    },
    phone: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    profile: {
        avatar: { type: String },
        address: { type: String },
        city: { type: String },
        state: { type: String }
    },
    referral: {
        code: { type: String, unique: true, sparse: true },
        referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },
    subBrokerId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    },
    walletBalance: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['Active', 'Inactive', 'Suspended', 'Blocked', 'Liquidated'], // Updated to support new actions
        default: 'Active'
    },
    // Signal Access Overrides
    signalAccess: [{
        category: { type: String, required: true }, // e.g. 'NIFTY_OPT', 'BANKNIFTY_OPT', 'STOCKS_INTRA', 'COMMODITY', 'FOREX'
        access: { type: Boolean, default: true },
        expiry: { type: Date }
    }],
    // Trading Stats (Mock/Snapshot)
    clientId: { type: String, unique: true, sparse: true }, // e.g. MS-1001
    equity: { type: Number, default: 0 },
    marginUsed: { type: Number, default: 0 },
    pnl: { type: Number, default: 0 },
    fcmTokens: [String],
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    isWhatsAppEnabled: {
      type: Boolean,
      default: true,
    },
    isNotificationEnabled: {
      type: Boolean,
      default: true,
    },
    isBlocked: { // Keeping for internal logic, but relying on status mostly
      type: Boolean,
      default: false
    },
    // Leaving legacy subscription field for now but moving to dedicated Subscription model
    subscription: {
      plan: {
        type: String,
        default: 'free',
      },
      expiresAt: Date,
    }, // Deprecated in favor of 'Subscription' collection
    // Single Session & IP Tracking
    tokenVersion: {
      type: Number,
      default: 0
    },
    lastLoginIp: {
      type: String,
      default: null
    },
    currentDeviceId: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true,
  }
);

// Encrypt password using bcrypt
userSchema.pre('save', async function () {
  // Keep these feature flags always enabled and non-editable.
  this.isWhatsAppEnabled = true;
  this.isNotificationEnabled = true;

  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);

export default User;

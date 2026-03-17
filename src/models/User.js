import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import ClientIdSequence from './ClientIdSequence.js';

const emptyStringToUndefined = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
};

const buildClientIdKey = (date) => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return `client-id:${year}-${String(month).padStart(2, '0')}`;
};

const generateClientId = async (date = new Date()) => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const sequence = await ClientIdSequence.findOneAndUpdate(
    { key: buildClientIdKey(date) },
    { $inc: { lastValue: 1 } },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  const runningNumber = month * 1000 + sequence.lastValue;
  return `MSPK-C${year}-${runningNumber}`;
};

const marketNamedWatchlistSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      default: () => new mongoose.Types.ObjectId().toHexString(),
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    symbols: {
      type: [String],
      default: [],
    },
    customSymbols: {
      type: [String],
      default: [],
    },
    templateKey: {
      type: String,
      trim: true,
      lowercase: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

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
    preferredSegments: [{
        type: String,
        enum: ['NSE', 'ALL', 'OPTIONS', 'MCX', 'FOREX', 'CRYPTO']
    }],
    referral: {
        code: { type: String, unique: true, sparse: true },
        referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },
    tradingViewId: {
        type: String,
        trim: true
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
        enum: ['Active', 'Inactive', 'Suspended', 'Blocked'], // Updated to support new actions
        default: 'Active'
    },
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
    isEmailAlertEnabled: {
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
    },
    telegramChatId: {
      type: String,
      trim: true,
      set: emptyStringToUndefined,
    },
    telegramUsername: {
      type: String,
      trim: true,
      set: emptyStringToUndefined,
    },
    telegramDisplayName: {
      type: String,
      trim: true,
      set: emptyStringToUndefined,
    },
    telegramConnectedAt: {
      type: Date,
    },
    telegramLinkToken: {
      type: String,
      trim: true,
      set: emptyStringToUndefined,
    },
    telegramLinkTokenExpiresAt: {
      type: Date,
    },
    lastOtpSentAt: {
      type: Date,
    },
    lastOtpChannel: {
      type: String,
      enum: ['email', 'phone'],
    },
    lastOtpTarget: {
      type: String,
      trim: true,
    },
    marketWatchlist: {
      type: [String],
      default: []
    },
    signalWatchlist: {
      type: [String],
      default: undefined,
    },
    marketWatchlists: {
      type: [marketNamedWatchlistSchema],
      default: [],
    },
    activeMarketWatchlistId: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index(
  { telegramChatId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      telegramChatId: {
        $type: 'string',
      },
    },
  }
);

userSchema.index(
  { telegramLinkToken: 1 },
  {
    unique: true,
    partialFilterExpression: {
      telegramLinkToken: {
        $type: 'string',
      },
    },
  }
);

// Encrypt password using bcrypt
userSchema.pre('save', async function () {
  // Default these flags on for new/legacy users, but allow user-controlled opt-out later.
  if (typeof this.isWhatsAppEnabled !== 'boolean') {
    this.isWhatsAppEnabled = true;
  }
  if (typeof this.isNotificationEnabled !== 'boolean') {
    this.isNotificationEnabled = true;
  }

  if (this.isNew && !this.clientId) {
    const createdAt = this.createdAt instanceof Date ? this.createdAt : new Date();
    this.clientId = await generateClientId(createdAt);
  }

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

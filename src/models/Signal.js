import mongoose from 'mongoose';

const signalSchema = new mongoose.Schema(
  {
    uniqueId: {
      type: String,
      trim: true,
    },
    webhookId: {
      type: String,
      trim: true,
      index: true,
    },
    symbol: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    segment: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true, 
      enum: [
        'EQUITY_INTRA', 
        'EQUITY_DELIVERY', 
        'NIFTY_OPT', 
        'BANKNIFTY_OPT', 
        'FINNIFTY_OPT', 
        'STOCK_OPT', 
        'MCX_FUT', 
        'CURRENCY', 
        'CRYPTO',
        'BTST',
        'HERO_ZERO'
      ]
    },
    type: {
      type: String,
      enum: ['BUY', 'SELL'],
      required: true,
    },
    entryPrice: {
      type: Number, // Frontend expects single value 'entry'
      required: true,
    },
    stopLoss: {
      type: Number,
      required: true,
    },
    targets: {
      target1: { type: Number, required: true },
      target2: { type: Number },
      target3: { type: Number },
    },
    status: {
      type: String,
      enum: ['Active', 'Target Hit', 'Stoploss Hit', 'Closed'], // Matched Frontend Mock
      default: 'Active',
    },
    isFree: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
    },
    attachments: [
      {
        type: String, // URL
      },
    ],
    // For admin audit
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false // Allow automated signals from 'system' to be null
    },
    // Strategy Reference
    strategyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Strategy',
        required: false
    },
    strategyName: {
        type: String,
        required: false
    },
    timeframe: {
        type: String,
        required: false
    },
    signalTime: {
        type: Date,
        required: false
    },
    exitPrice: {
      type: Number,
      required: false,
    },
    totalPoints: {
      type: Number,
      required: false,
    },
    exitReason: {
      type: String,
      required: false,
    },
    exitTime: {
      type: Date,
      required: false,
    },
    metrics: {
        sma: Number,
        ema: Number,
        supertrend: Number,
        rsi: Number,
        psar: Number
    }
  },
  {
    timestamps: true,
  }
);

signalSchema.index({ uniqueId: 1 }, { unique: true, sparse: true });

const Signal = mongoose.model('Signal', signalSchema);

export default Signal;

import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
    },
    segment: {
      type: String,
      enum: ['EQUITY', 'FNO', 'COMMODITY', 'CURRENCY'],
      // required: true, // Made optional to support multi-segment plans
    },
    permissions: [{
      type: String,
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
    }],
    price: {
      type: Number,
      required: true,
    },
    durationDays: {
      type: Number,
      required: true, // e.g., 30, 90, 365
    },
    features: [
      {
        type: String,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    isDemo: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Plan = mongoose.model('Plan', planSchema);

export default Plan;

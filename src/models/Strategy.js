import mongoose from 'mongoose';

const strategySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    symbol: {
      type: String,
      required: true,
      uppercase: true,
    },
    timeframe: {
      type: String,
      required: true, // e.g., '1m', '5m', '1h'
    },
    segment: {
      type: String,
      enum: ['EQUITY', 'FNO', 'COMMODITY', 'CURRENCY', 'GLOBAL'],
      required: true,
      default: 'EQUITY'
    },
    // For Multi-Symbol Strategies
    symbols: [{ type: String, uppercase: true }], 
    
    candleType: {
        type: String,
        enum: ['Standard', 'HeikinAshi'],
        default: 'Standard'
    },
    
    risk: {
        riskRewardRatio: { type: Number, default: 2 }, // 1:2
        stopLossType: { type: String, enum: ['Fixed%', 'Indicator', 'Swing'], default: 'Fixed%' },
        stopLossValue: { type: Number, default: 1 } // 1% or Indicator Period
    },

    stats: {
        totalSignals: { type: Number, default: 0 },
        successCount: { type: Number, default: 0 },
        lastSignalAt: { type: Date }
    },
    // Dynamic Rules Engine Structure
    // Example: { 
    //   condition: 'AND', 
    //   rules: [
    //     { indicator: 'RSI', period: 14, operator: '<', value: 30 },
    //     { indicator: 'SMA', period: 50, operator: '>', value: 'SMA', valuePeriod: 200 }
    //   ] 
    // }
    logic: {
      condition: {
        type: String,
        enum: ['AND', 'OR'],
        default: 'AND'
      },
      rules: [{
        indicator: { type: String, required: true }, // RSI, SMA, EMA, MACD, Supertrend, PSAR
        params: { type: Map, of: Number }, // { period: 14, multiplier: 1.5 }
        operator: { type: String, enum: ['>', '<', '>=', '<=', '==', 'CROSS_ABOVE', 'CROSS_BELOW'], required: true },
        comparisonType: { type: String, enum: ['VALUE', 'INDICATOR'], default: 'VALUE' },
        value: { type: mongoose.Schema.Types.Mixed, required: true }, // 30 or { indicator: 'SMA', params: {...} }
      }]
    },
    action: {
      type: String,
      enum: ['BUY', 'SELL', 'ALERT'], // ALERT = Both/Signaling
      default: 'ALERT'
    },
    status: {
      type: String,
      enum: ['Active', 'Paused', 'Archived'],
      default: 'Paused'
    },
    isSystem: {
      type: Boolean,
      default: false
    },
    isDefault: {
      type: Boolean,
      default: false
    },
  },
  {
    timestamps: true,
  }
);

const Strategy = mongoose.model('Strategy', strategySchema);

export default Strategy;

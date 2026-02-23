import mongoose from 'mongoose';

const masterSymbolSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: true,
      unique: true,
      uppercase: true, // e.g., "NIFTY 50", "RELIANCE"
    },
    name: {
        type: String,
        required: true, // e.g., "Nifty 50 Index"
    },
    segment: {
      type: String, 
      required: true, // e.g., "FNO", "EQUITY" (Matches MasterSegment.code)
    },
    exchange: {
        type: String,
        default: 'NSE'
    },
    lotSize: {
        type: Number,
        default: 1
    },
    tickSize: {
        type: Number,
        default: 0.05
    },
    isActive: {
      type: Boolean,
      default: true
    },
    instrumentToken: {
        type: String // Kite Instrument Token
    },
    isWatchlist: {
        type: Boolean,
        default: false
    }
  },
  {
    timestamps: true,
  }
);

const MasterSymbol = mongoose.model('MasterSymbol', masterSymbolSchema);

export default MasterSymbol;

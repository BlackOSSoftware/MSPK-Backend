import mongoose from 'mongoose';

const marketWatchlistTemplateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    order: {
      type: Number,
      default: 100,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    symbolLimit: {
      type: Number,
      default: 10,
      min: 1,
      max: 50,
    },
    preferredSymbols: {
      type: [String],
      default: [],
    },
    selector: {
      bucket: {
        type: String,
        trim: true,
      },
      segments: {
        type: [String],
        default: [],
      },
      exchanges: {
        type: [String],
        default: [],
      },
      symbolPrefixes: {
        type: [String],
        default: [],
      },
      symbolIncludes: {
        type: [String],
        default: [],
      },
      nameIncludes: {
        type: [String],
        default: [],
      },
    },
  },
  {
    timestamps: true,
  }
);

marketWatchlistTemplateSchema.index({ isActive: 1, order: 1, name: 1 });

const MarketWatchlistTemplate = mongoose.model(
  'MarketWatchlistTemplate',
  marketWatchlistTemplateSchema
);

export default MarketWatchlistTemplate;


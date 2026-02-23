import mongoose from 'mongoose';

const segmentSchema = new mongoose.Schema(
  {
    segment_code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      enum: ['EQUITY', 'CRYPTO', 'COMMODITY', 'FOREX', 'OPTIONS']
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    base_price: {
      type: Number,
      default: 25000,
      min: 0
    },
    is_active: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

// Indexes for fast lookup
segmentSchema.index({ segment_code: 1 });
segmentSchema.index({ is_active: 1 });

const Segment = mongoose.model('Segment', segmentSchema);

export default Segment;

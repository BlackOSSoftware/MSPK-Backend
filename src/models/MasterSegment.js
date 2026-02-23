import mongoose from 'mongoose';

const masterSegmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true, // e.g., "Equity Intraday"
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true, // e.g., "EQUITY", "FNO"
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
  }
);

const MasterSegment = mongoose.model('MasterSegment', masterSegmentSchema);

export default MasterSegment;

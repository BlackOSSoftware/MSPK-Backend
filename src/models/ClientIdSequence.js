import mongoose from 'mongoose';

const clientIdSequenceSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    lastValue: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

const ClientIdSequence =
  mongoose.models.ClientIdSequence ||
  mongoose.model('ClientIdSequence', clientIdSequenceSchema);

export default ClientIdSequence;

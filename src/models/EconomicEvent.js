import mongoose from 'mongoose';

const economicEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, unique: true, index: true },
    date: { type: Date, required: true, index: true },
    country: { type: String, index: true }, // e.g., 'US', 'EU'
    event: { type: String, required: true },
    currency: { type: String }, // e.g., 'USD'
    impact: { type: String, enum: ['Low', 'Medium', 'High', 'None'], default: 'None' },
    actual: { type: String },
    forecast: { type: String },
    previous: { type: String },
    unit: { type: String },
    isAlertSent: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const EconomicEvent = mongoose.model('EconomicEvent', economicEventSchema);

export default EconomicEvent;

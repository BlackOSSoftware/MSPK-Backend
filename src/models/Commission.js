import mongoose from 'mongoose';

const commissionSchema = new mongoose.Schema(
  {
    subBroker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId, // The user who made the purchase
      ref: 'User',
      required: true,
    },
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    percentage: {
      type: Number, // Commission percentage at that time
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PAID'],
      default: 'PENDING',
    },
  },
  {
    timestamps: true,
  }
);

const Commission = mongoose.model('Commission', commissionSchema);

export default Commission;

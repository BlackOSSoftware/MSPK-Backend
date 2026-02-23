import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    subject: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: ['General', 'Technical', 'Billing', 'Feature Request', 'Other', 'PAYMENT', 'ACCOUNT', 'TECHNICAL', 'OTHER'], 
      default: 'General',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent', 'LOW', 'MEDIUM', 'HIGH'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
      default: 'OPEN',
    },
    messages: [
      {
        sender: { type: String, enum: ['USER', 'ADMIN'], required: true },
        message: { type: String, required: true },
        attachments: [String],
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

const Ticket = mongoose.model('Ticket', ticketSchema);

export default Ticket;

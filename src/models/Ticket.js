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
    },
    contactName: {
      type: String,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
    },
    ticketType: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    contactEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    contactNumber: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'resolved', 'rejected'],
      default: 'pending',
    },
    source: {
      type: String,
      enum: ['user_ticket', 'dashboard_ticket', 'web_enquiry'],
      default: 'user_ticket',
    }
  },
  {
    timestamps: true,
  }
);

const Ticket = mongoose.model('Ticket', ticketSchema);

export default Ticket;

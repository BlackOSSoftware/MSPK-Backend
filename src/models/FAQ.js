import mongoose from 'mongoose';

const faqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    answer: { type: String, required: true },
    category: { 
        type: String, 
        default: 'General',
        enum: ['General', 'Account', 'Billing', 'Technical', 'Trading']
    },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const FAQ = mongoose.model('FAQ', faqSchema);

export default FAQ;

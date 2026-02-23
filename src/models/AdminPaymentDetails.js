import mongoose from 'mongoose';

const adminPaymentDetailsSchema = new mongoose.Schema(
  {
    upiId: {
      type: String,
      trim: true,
      default: ''
    },
    qrCodeUrl: {
      type: String, // URL to uploaded image
      trim: true,
      default: ''
    },
    bankName: {
      type: String,
      trim: true,
      default: ''
    },
    accountNumber: {
      type: String,
      trim: true,
      default: ''
    },
    ifscCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: ''
    },
    accountHolderName: {
      type: String,
      trim: true,
      default: ''
    },
    supportWhatsapp: {
      type: String,
      trim: true,
      default: '' // Format: 919999999999
    }
  },
  {
    timestamps: true,
    capped: { size: 1024, max: 1 } // Singleton: Only one record needed
  }
);

const AdminPaymentDetails = mongoose.model('AdminPaymentDetails', adminPaymentDetailsSchema);

export default AdminPaymentDetails;

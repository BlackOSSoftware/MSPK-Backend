import mongoose from 'mongoose';
import validator from 'validator';

const subBrokerSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      validate(value) {
        if (!validator.isEmail(value)) {
          throw new Error('Invalid email');
        }
      },
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    company: {
      type: String,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
    },
    brokerId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
    },
    telegramId: String,
    commission: {
        type: {
            type: String,
            enum: ['PERCENTAGE', 'FIXED'],
            default: 'PERCENTAGE'
        },
        value: {
            type: Number,
            required: true,
            default: 20
        }
    },
    status: {
        type: String,
        enum: ['Active', 'Blocked'],
        default: 'Active'
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    agreementDoc: String, // URL/Path to PDF
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual for total clients (Using User model later if needed, for now placeholders)
subBrokerSchema.virtual('totalClients').get(function() {
    return 0; // Placeholder, real implementation requires aggregation
});

// Virtual for total revenue
subBrokerSchema.virtual('totalRevenue').get(function() {
    return 0; // Placeholder
});

/**
 * Check if email is taken
 * @param {string} email - The user's email
 * @param {ObjectId} [excludeUserId] - The id of the user to be excluded
 * @returns {Promise<boolean>}
 */
subBrokerSchema.statics.isEmailTaken = async function (email, excludeId) {
  const user = await this.findOne({ email, _id: { $ne: excludeId } });
  return !!user;
};

const SubBroker = mongoose.model('SubBroker', subBrokerSchema);

export default SubBroker;

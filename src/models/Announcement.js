import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['SYSTEM', 'URGENT', 'UPDATE', 'EVENT', 'NEWS', 'SIGNAL', 'ECONOMIC', 'REMINDER'],
      default: 'NEWS',
    },
    priority: {
      type: String,
      enum: ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'],
      default: 'NORMAL',
    },
    targetAudience: {
      role: { type: String, enum: ['all', 'user', 'sub-broker'], default: 'all' },
      planValues: [String], // e.g. ['pro', 'enterprise']
      segments: [String],   // e.g. ['EQUITY_INTRA', 'NIFTY_OPT']
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
    },
    isActive: {
       type: Boolean,
       default: true,
    },
    isNotificationSent: {
        type: Boolean,
        default: false
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for status
announcementSchema.virtual('status').get(function () {
  if (!this.isActive) return 'Disabled';
  const now = new Date();
  if (this.startDate > now) return 'Scheduled';
  if (this.endDate && this.endDate < now) return 'Expired';
  return 'Active';
});

const Announcement = mongoose.model('Announcement', announcementSchema);

export default Announcement;

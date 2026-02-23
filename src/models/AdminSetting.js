import mongoose from 'mongoose';

const adminSettingSchema = new mongoose.Schema(
  {
    demo_validity_days: {
      type: Number,
      default: 1,
      min: 1
    },
    premium_validity_days: {
      type: Number,
      default: 30,
      min: 1
    },
    // Can be extended for other global configs
  },
  {
    timestamps: true,
    capped: { size: 1024, max: 1 } // Ensure singleton-like behavior (optional, but good for settings)
  }
);

const AdminSetting = mongoose.model('AdminSetting', adminSettingSchema);

export default AdminSetting;

import mongoose from 'mongoose';

const settingSchema = mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    description: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Plugin removed as it does not exist
// settingSchema.plugin(toJSON);


const Setting = mongoose.model('Setting', settingSchema);

export default Setting;

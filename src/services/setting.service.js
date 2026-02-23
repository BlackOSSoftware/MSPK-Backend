import Setting from '../models/Setting.js';

const getSetting = async (key) => {
  const setting = await Setting.findOne({ key });
  return setting ? setting.value : null;
};

const setSetting = async (key, value, description) => {
  const update = { value };
  if (description) update.description = description;
  
  const setting = await Setting.findOneAndUpdate(
    { key },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return setting;
};

const getAllSettings = async () => {
  return Setting.find({});
};

export default {
  getSetting,
  setSetting,
  getAllSettings,
};

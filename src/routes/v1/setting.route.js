import express from 'express';
import auth from '../middlewares/auth.js';
import settingController from '../../controllers/setting.controller.js';

const router = express.Router();

router
  .route('/')
  .get(auth('managePlans'), settingController.getSettings)
  .patch(auth('managePlans'), settingController.updateSetting);

router
  .route('/bulk')
  .put(auth('managePlans'), settingController.updateBulkSettings);

export default router;

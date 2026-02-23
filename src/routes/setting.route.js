import express from 'express';
import auth from '../middleware/auth.js';
import settingController from '../controllers/setting.controller.js';

const router = express.Router();

// All settings routes require Admin access
router.use(auth(['admin']));

router
  .route('/')
  .get(settingController.getSettings)
  .patch(settingController.updateSetting);

router.put('/bulk', settingController.updateBulkSettings);

export default router;

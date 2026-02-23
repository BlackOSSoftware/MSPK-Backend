import express from 'express';
import auth from '../middleware/auth.js';
import adminController from '../controllers/admin.controller.js';

import validate from '../middleware/validate.js';
import adminValidation from '../validations/admin.validation.js';

const router = express.Router();

// Protect all routes: Must be Logged In AND have 'admin' role
router.use(auth(['admin']));

router
  .route('/users')
  .get(adminController.getUsers)
  .post(validate(adminValidation.createUser), adminController.createUser);

router
  .route('/users/:userId/signals')
  .patch(adminController.updateSignalAccess);

router
  .route('/users/:userId')
  .get(adminController.getUser)
  .patch(validate(adminValidation.updateUser), adminController.updateUser)
  .delete(adminController.deleteUser);

router.patch('/users/:userId/block', adminController.blockUser);
router.patch('/users/:userId/liquidate', adminController.liquidateUser);

router
  .route('/system/health')
  .get(adminController.getSystemHealth);

router
  .route('/strategy/status')
  .get(adminController.getStrategyStatus);

router.post('/broadcast', adminController.broadcastMessage);

export default router;

import express from 'express';
import auth from '../middleware/auth.js';
import adminController from '../controllers/admin.controller.js';

import validate from '../middleware/validate.js';
import adminValidation from '../validations/admin.validation.js';

const router = express.Router();

// Protect all routes: Must be Logged In AND have 'admin' role
router.use(auth(['admin']));

router
  .route('/users/export')
  .get(adminController.exportUsers);

router
  .route('/users')
  .get(adminController.getUsers)
  .post(validate(adminValidation.createUser), adminController.createUser);

router
  .route('/users/:userId/signal-deliveries')
  .get(adminController.getUserSignalDeliveries);

router
  .route('/users/:userId')
  .get(adminController.getUser)
  .patch(validate(adminValidation.updateUser), adminController.updateUser)
  .delete(adminController.deleteUser);

router.post(
  '/users/:userId/custom-plan',
  validate(adminValidation.assignCustomPlan),
  adminController.assignCustomPlan
);

router.patch('/users/:userId/block', adminController.blockUser);

router
  .route('/system/health')
  .get(adminController.getSystemHealth);

router.post('/broadcast', adminController.broadcastMessage);
router.post('/reminders/renewal', adminController.sendRenewalReminders);
router.post('/reminders/demo', adminController.sendDemoReminders);

export default router;

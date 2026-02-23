
import express from 'express';
import auth from '../middleware/auth.js';
import notificationController from '../controllers/notification.controller.js';

const router = express.Router();

router.use(auth());

router.get('/', notificationController.getMyNotifications);
router.post('/fcm-token', notificationController.registerFCMToken);
router.patch('/read-all', notificationController.markAllAsRead);

router.route('/:notificationId')
  .get(notificationController.getNotification)
  .delete(notificationController.deleteNotification);

router.patch('/:notificationId/read', notificationController.markAsRead);

export default router;

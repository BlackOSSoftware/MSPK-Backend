
import express from 'express';
import auth from '../middleware/auth.js';
import notificationController from '../controllers/notification.controller.js';

const router = express.Router();

router.post('/telegram/webhook/:secret', notificationController.handleTelegramWebhook);

router.use(auth());

router.get('/', notificationController.getMyNotifications);
router.post('/fcm-token', notificationController.registerFCMToken);
router.delete('/fcm-token', notificationController.unregisterFCMToken);
router.patch('/read-all', notificationController.markAllAsRead);
router.get('/telegram/connect-link', notificationController.getTelegramConnectLink);
router.post('/telegram/disconnect', notificationController.disconnectTelegram);

router.route('/:notificationId')
  .get(notificationController.getNotification)
  .delete(notificationController.deleteNotification);

router.patch('/:notificationId/read', notificationController.markAsRead);

export default router;

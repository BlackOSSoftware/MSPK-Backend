import express from 'express';
import auth from '../middleware/auth.js';
import subscriptionController from '../controllers/subscription.controller.js';

const router = express.Router();

router.use(auth()); // All routes require login

// /api/subscribe/purchase
router.post('/purchase', subscriptionController.purchase);

// /api/subscribe/status
router.get('/status', subscriptionController.getStatus);

// /api/subscriptions/admin/all
router.get('/admin/all', subscriptionController.getAllSubscriptions);

// /api/subscriptions/has-access/:segment
router.get('/has-access/:segment', subscriptionController.checkAccess);

export default router;

import express from 'express';
import analyticsController from '../controllers/analytics.controller.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.route('/')
    .get(auth('admin'), analyticsController.getAnalytics);

router.route('/export')
    .get(auth('admin'), analyticsController.exportAnalytics);

export default router;

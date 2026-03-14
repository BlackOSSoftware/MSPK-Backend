import express from 'express';
import auth from '../middleware/auth.js';
import optionalAuth from '../middleware/optionalAuth.js';
import planEnquiryController from '../controllers/planEnquiry.controller.js';

const router = express.Router();

router.post('/', optionalAuth(), planEnquiryController.createPlanEnquiry);
router.get('/', auth(['admin']), planEnquiryController.getPlanEnquiries);
router.patch('/:id', auth(['admin']), planEnquiryController.updatePlanEnquiryStatus);

export default router;

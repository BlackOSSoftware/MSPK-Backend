import express from 'express';
import validate from '../middleware/validate.js'; // Assuming you have validation logic, skipping for speed or basic valid
import leadController from '../controllers/lead.controller.js';
import auth from '../middleware/auth.js';

import upload from '../middleware/upload.js';

const router = express.Router();

// Public: Create Request
router.post('/', upload.single('paymentScreenshot'), leadController.createLead);

// Admin: View Leads
router.get('/', auth(['admin']), leadController.getLeads);

// Admin: Individual Lead Operations
router.route('/:id')
    .get(auth(['admin']), leadController.getLead)
    .patch(auth(['admin']), leadController.updateLead)
    .delete(auth(['admin']), leadController.deleteLead);

// Admin: Approve Lead
router.post('/:id/approve', auth(['admin']), leadController.approveLead);

export default router;

import express from 'express';
import auth from '../middleware/auth.js';
import dashboardController from '../controllers/dashboard.controller.js';

const router = express.Router();

router.use(auth());

// User Routes
router.post('/tickets', dashboardController.createTicket);
router.get('/tickets', dashboardController.getMyTickets);

// Admin Routes (Would normally be under /admin/...)
// But since we are creating a unified module, let's keep it here or separate?
// The task says "Implement specific APIs for Admin Dashboard Stats".
// I'll put specific admin routes here protected by auth(['admin'])

router.get('/stats', auth(['admin']), dashboardController.getStats);
router.get('/admin/tickets', auth(['admin']), dashboardController.getAllTickets);

export default router;

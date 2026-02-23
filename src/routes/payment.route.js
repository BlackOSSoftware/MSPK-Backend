import express from 'express';
import auth from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import paymentController from '../controllers/payment.controller.js';

const router = express.Router();

// Public/Auth: Get Admin Payment Details (UPI, QR)
router.get('/details', auth(), paymentController.getPaymentDetails);

// Admin: Update Payment Details (with QR upload)
router.put('/details', auth('admin'), upload.single('qrCode'), paymentController.updatePaymentDetails);

// User: Submit Manual Payment (with Screenshot upload)
router.post('/verify-payment', auth(), upload.single('screenshot'), paymentController.submitPayment);

export default router;

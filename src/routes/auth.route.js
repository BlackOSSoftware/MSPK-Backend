import express from 'express';
import validate from '../middleware/validate.js';
import authValidation from '../validations/auth.validation.js';
import authController from '../controllers/auth.controller.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.post('/register', validate(authValidation.register), authController.register);
router.post('/login', validate(authValidation.login), authController.login);
router.post('/send-otp', validate(authValidation.sendOtp), authController.sendOtp);
router.post('/verify-otp', validate(authValidation.verifyOtp), authController.verifyOtp);

// Authenticated Routes
router.use(auth()); // All routes below require authentication

import upload from '../middleware/upload.js';

router.route('/me')
    .get(authController.getMe)
    .patch(upload.single('avatar'), validate(authValidation.updateProfile), authController.updateMe);

router.post('/me/kyc', validate(authValidation.updateKyc), authController.updateKyc);
router.post('/logout', authController.logout);

export default router;

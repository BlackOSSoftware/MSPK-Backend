import express from 'express';
import auth from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import signalValidation from '../validations/signal.validation.js';
import signalController from '../controllers/signal.controller.js';

const router = express.Router();

// Public (Optional Auth: Guests see Free/Closed, Users see based on sub)
import optionalAuth from '../middleware/optionalAuth.js';
router.get('/', optionalAuth(), signalController.getSignals);
router.get('/:signalId/analysis', optionalAuth(), signalController.getSignalAnalysis);
router.get('/:signalId', optionalAuth(), signalController.getSignal);

// Admin Only
router.post('/', auth(['admin']), validate(signalValidation.createSignal), signalController.createSignal);
router.post('/manual', auth(['admin']), validate(signalValidation.createSignal), signalController.createManualSignal);
router.patch('/:signalId', auth(['admin']), validate(signalValidation.updateSignal), signalController.updateSignal);
router.delete('/:signalId', auth(['admin']), validate(signalValidation.deleteSignal), signalController.deleteSignal);

export default router;

import express from 'express';
import validate from '../middleware/validate.js';
import webhookValidation from '../validations/webhook.validation.js';
import webhookController from '../controllers/webhook.controller.js';

const router = express.Router();

router.post('/signals', validate(webhookValidation.receiveSignal), webhookController.receiveSignal);

export default router;

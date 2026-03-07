import express from 'express';
import validate from '../middleware/validate.js';
import webhookValidation from '../validations/webhook.validation.js';
import webhookController from '../controllers/webhook.controller.js';

const router = express.Router();

const normalizeWebhookBody = (req, res, next) => {
  if (typeof req.body !== 'string') {
    return next();
  }

  const rawBody = req.body.trim();
  if (!rawBody) {
    req.body = {};
    return next();
  }

  try {
    req.body = JSON.parse(rawBody);
    return next();
  } catch (error) {
    return res.status(400).send({
      status: 'error',
      statusCode: 400,
      message: 'Webhook body must be valid JSON.',
    });
  }
};

router.post('/', normalizeWebhookBody, validate(webhookValidation.receiveSignal), webhookController.receiveSignal);
router.post('/signals', normalizeWebhookBody, validate(webhookValidation.receiveSignal), webhookController.receiveSignal);

export default router;

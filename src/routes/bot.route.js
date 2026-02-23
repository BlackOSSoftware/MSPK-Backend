import express from 'express';
import validate from '../middleware/validate.js';
import botController from '../controllers/bot.controller.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router
  .route('/status')
  .get(auth(), botController.getStatus); // Any logged in user

router
  .route('/toggle')
  .post(auth(['admin']), botController.toggleBot); // Only admin

export default router;

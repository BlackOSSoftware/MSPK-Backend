import express from 'express';
import economicController from '../controllers/economic.controller.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router
  .route('/')
  .get(auth(), economicController.getCalendar); // Using generic auth (login required) but no specific rights
  // OR just .get(economicController.getCalendar); if public


export default router;

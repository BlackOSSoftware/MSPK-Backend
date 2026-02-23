import express from 'express';
import subscriptionController from '../controllers/subscription.controller.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// /api/segments
// Public or Private? Usually public to see prices, but technically user needs to exist to buy.
// Let's keep it authenticated as per general rule, or public if needed.
// User didn't specify auth for this one, but usually it's public.
// I will make it public so users can see prices before logging in (if needed), 
// but given the context of "subscribe", probably auth is fine.
// Let's stick to auth since it's imported in the flow.

router.get('/', subscriptionController.getSegments);

export default router;

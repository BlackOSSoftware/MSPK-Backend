import express from 'express';
import strategyController from '../controllers/strategy.controller.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router
  .route('/')
  .post(auth(), strategyController.createStrategy)
  .get(auth(), strategyController.getStrategies);

router.post('/seed', auth(), strategyController.seedStrategies);

router
  .route('/:strategyId')
  .patch(auth(), strategyController.updateStrategy)
  .delete(auth(), strategyController.deleteStrategy);

export default router;

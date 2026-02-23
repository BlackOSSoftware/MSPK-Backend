import express from 'express';
import auth from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import planValidation from '../validations/plan.validation.js';
import planController from '../controllers/plan.controller.js';

const router = express.Router();

// Public/User: View Plans
router
  .route('/')
  .get(validate(planValidation.getPlans), planController.getPlans);

router
  .route('/:planId')
  .get(validate(planValidation.getPlan), planController.getPlan);

// Admin Only: Create/Update
router.use(auth(['admin']));

router
  .route('/')
  .post(validate(planValidation.createPlan), planController.createPlan);

router
  .route('/:planId')
  .patch(validate(planValidation.updatePlan), planController.updatePlan)
  .delete(validate(planValidation.deletePlan), planController.deletePlan);

export default router;

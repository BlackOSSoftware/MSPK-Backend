import express from 'express';
import validate from '../middleware/validate.js';
import auth from '../middleware/auth.js';
import ticketController from '../controllers/ticket.controller.js';
import enquiryValidation from '../validations/enquiry.validation.js';
import ticketValidation from '../validations/ticket.validation.js';
import optionalAuth from '../middleware/optionalAuth.js';
import planEnquiryController from '../controllers/planEnquiry.controller.js';

const router = express.Router();

router
  .route('/')
  .post(validate(enquiryValidation.createEnquiry), ticketController.createEnquiry)
  .get(auth(['admin']), ticketController.getEnquiries);

router
  .route('/:id')
  .patch(auth(['admin']), validate(ticketValidation.updateTicketStatus), ticketController.updateEnquiry);

router
  .route('/plans')
  .post(optionalAuth(), planEnquiryController.createPlanEnquiry)
  .get(auth(['admin']), planEnquiryController.getPlanEnquiries);

router
  .route('/plans/:id')
  .patch(auth(['admin']), planEnquiryController.updatePlanEnquiryStatus);

export default router;

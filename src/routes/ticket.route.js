import express from 'express';
import validate from '../middleware/validate.js';
import ticketController from '../controllers/ticket.controller.js';
import ticketValidation from '../validations/ticket.validation.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router
  .route('/')
  .post(validate(ticketValidation.createTicket), ticketController.createTicket)
  .get(auth(), ticketController.getTickets);

router
  .route('/:id')
  .get(auth(), ticketController.getTicketById)
  .patch(auth(['admin']), validate(ticketValidation.updateTicketStatus), ticketController.updateTicket);

export default router;

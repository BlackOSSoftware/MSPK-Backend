import express from 'express';
import validate from '../middleware/validate.js';
import ticketController from '../controllers/ticket.controller.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router
  .route('/')
  .post(auth(), ticketController.createTicket)
  .get(auth(), ticketController.getTickets);

router
  .route('/:id')
  .get(auth(), ticketController.getTicketById)
  .patch(auth(['admin']), ticketController.updateTicket); // Only Admins can update tickets

router.route('/:id/reply')
  .post(auth(), ticketController.replyToTicket);

router.route('/:id/messages/:messageId')
  .patch(auth(), ticketController.editMessage)
  .delete(auth(), ticketController.deleteMessage);

export default router;

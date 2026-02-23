import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import { dashboardService } from '../services/index.js';
import Ticket from '../models/Ticket.js';

const createTicket = catchAsync(async (req, res) => {
  const ticket = await dashboardService.createTicket(req.body, req.user);
  res.status(httpStatus.CREATED).send(ticket);
});

const getTickets = catchAsync(async (req, res) => {
  const filter = req.user.role === 'admin' ? {} : { user: req.user.id };
  const tickets = await dashboardService.getTickets(filter);
  res.send(tickets);
});

const getTicketById = catchAsync(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id).populate('user', 'name email');
  if (!ticket) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Ticket not found' });
  }
  res.send(ticket);
});

const updateTicket = catchAsync(async (req, res) => {
  const ticket = await Ticket.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.send(ticket);
});

const replyToTicket = catchAsync(async (req, res) => {
  const ticket = await dashboardService.replyToTicket(req.params.id, {
    sender: req.user.role === 'admin' ? 'ADMIN' : 'USER',
    message: req.body.message,
    attachments: req.body.attachments
  });
  res.send(ticket);
});

const editMessage = catchAsync(async (req, res) => {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(httpStatus.NOT_FOUND).send({ message: 'Ticket not found' });
    
    const message = ticket.messages.id(req.params.messageId);
    if (!message) return res.status(httpStatus.NOT_FOUND).send({ message: 'Message not found' });
    
    message.message = req.body.message;
    await ticket.save();
    res.send(ticket);
});

const deleteMessage = catchAsync(async (req, res) => {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(httpStatus.NOT_FOUND).send({ message: 'Ticket not found' });
    
    ticket.messages.pull({ _id: req.params.messageId });
    await ticket.save();
    res.send(ticket);
});

export default {
  createTicket,
  getTickets,
  getTicketById,
  updateTicket,
  replyToTicket,
  editMessage,
  deleteMessage
};

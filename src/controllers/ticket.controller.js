import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import Ticket from '../models/Ticket.js';

const createTicket = catchAsync(async (req, res) => {
  const lastTicket = await Ticket.findOne().sort({ createdAt: -1 });
  let nextId = 1001;
  if (lastTicket?.ticketId) {
    const lastNum = parseInt(lastTicket.ticketId.replace('TK-', ''), 10);
    if (!Number.isNaN(lastNum)) nextId = lastNum + 1;
  }

  const ticket = await Ticket.create({
    ticketId: `TK-${nextId}`,
    user: req.user?.id,
    subject: req.body.subject,
    ticketType: req.body.ticketType,
    description: req.body.description,
    contactEmail: req.body.contactEmail,
    contactNumber: req.body.contactNumber,
    status: 'pending',
  });

  res.status(httpStatus.CREATED).send(ticket);
});

const getTickets = catchAsync(async (req, res) => {
  const filter = req.user.role === 'admin' ? {} : { user: req.user.id };
  const tickets = await Ticket.find(filter)
    .sort({ updatedAt: -1 })
    .populate('user', 'name email phone');
  res.send(tickets);
});

const getTicketById = catchAsync(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id).populate('user', 'name email phone');
  if (!ticket) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Ticket not found' });
  }

  if (req.user.role !== 'admin' && ticket.user?._id.toString() !== req.user.id.toString()) {
    return res.status(httpStatus.FORBIDDEN).send({ message: 'Forbidden' });
  }

  res.send(ticket);
});

const updateTicket = catchAsync(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Ticket not found' });
  }

  if (ticket.status !== 'pending') {
    return res.status(httpStatus.BAD_REQUEST).send({ message: 'Only pending tickets can be updated.' });
  }

  ticket.status = req.body.status;
  await ticket.save();

  res.send(ticket);
});

export default {
  createTicket,
  getTickets,
  getTicketById,
  updateTicket
};

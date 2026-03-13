import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import Ticket from '../models/Ticket.js';

const normalizeTicketStatus = (status) => (status || '').toString().trim().toLowerCase();
const isUpdatableTicketStatus = (status) => ['pending', 'open'].includes(normalizeTicketStatus(status));

const getNextTicketId = async () => {
  const lastTicket = await Ticket.findOne().sort({ createdAt: -1 });
  let nextId = 1001;

  if (lastTicket?.ticketId) {
    const lastNum = parseInt(lastTicket.ticketId.replace('TK-', ''), 10);
    if (!Number.isNaN(lastNum)) nextId = lastNum + 1;
  }

  return `TK-${nextId}`;
};

const createTicket = catchAsync(async (req, res) => {
  const userId = req.user?.id || req.user?._id;
  if (!userId) {
    return res.status(httpStatus.UNAUTHORIZED).send({ message: 'Please authenticate' });
  }

  const ticket = await Ticket.create({
    ticketId: await getNextTicketId(),
    user: userId,
    contactName: req.body.contactName || req.user?.name || '',
    subject: req.body.subject,
    ticketType: req.body.ticketType,
    description: req.body.description,
    contactEmail: req.body.contactEmail,
    contactNumber: req.body.contactNumber,
    status: 'pending',
    source: 'user_ticket',
  });

  res.status(httpStatus.CREATED).send(ticket);
});

const createEnquiry = catchAsync(async (req, res) => {
  const ticket = await Ticket.create({
    ticketId: await getNextTicketId(),
    contactName: req.body.contactName,
    subject: req.body.subject,
    ticketType: req.body.ticketType?.trim() || req.body.subject,
    description: req.body.description,
    contactEmail: req.body.contactEmail,
    contactNumber: req.body.contactNumber,
    status: 'pending',
    source: 'web_enquiry',
  });

  res.status(httpStatus.CREATED).send(ticket);
});

const getTickets = catchAsync(async (req, res) => {
  const userId = req.user?.id || req.user?._id;
  if (!userId && req.user?.role !== 'admin') {
    return res.status(httpStatus.UNAUTHORIZED).send({ message: 'Please authenticate' });
  }
  const filter = req.user.role === 'admin' ? { source: { $ne: 'web_enquiry' } } : { user: userId };
  const tickets = await Ticket.find(filter)
    .sort({ updatedAt: -1 })
    .populate('user', 'name email phone');
  res.send(tickets);
});

const getEnquiries = catchAsync(async (req, res) => {
  const enquiries = await Ticket.find({ source: 'web_enquiry' })
    .sort({ updatedAt: -1 })
    .populate('user', 'name email phone');

  res.send(enquiries);
});

const getTicketById = catchAsync(async (req, res) => {
  const userId = req.user?.id || req.user?._id;
  if (!userId && req.user?.role !== 'admin') {
    return res.status(httpStatus.UNAUTHORIZED).send({ message: 'Please authenticate' });
  }
  const ticket = await Ticket.findById(req.params.id).populate('user', 'name email phone');
  if (!ticket) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Ticket not found' });
  }

  if (req.user.role !== 'admin' && ticket.user?._id.toString() !== userId.toString()) {
    return res.status(httpStatus.FORBIDDEN).send({ message: 'Forbidden' });
  }

  res.send(ticket);
});

const updateTicket = catchAsync(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Ticket not found' });
  }

  if (!isUpdatableTicketStatus(ticket.status)) {
    return res.status(httpStatus.BAD_REQUEST).send({ message: 'Only open or pending tickets can be updated.' });
  }

  ticket.status = req.body.status;
  await ticket.save();

  res.send(ticket);
});

const updateEnquiry = catchAsync(async (req, res) => {
  const enquiry = await Ticket.findOne({ _id: req.params.id, source: 'web_enquiry' });
  if (!enquiry) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Enquiry not found' });
  }

  if (!isUpdatableTicketStatus(enquiry.status)) {
    return res.status(httpStatus.BAD_REQUEST).send({ message: 'Only open or pending enquiries can be updated.' });
  }

  enquiry.status = req.body.status;
  await enquiry.save();

  res.send(enquiry);
});

export default {
  createTicket,
  createEnquiry,
  getTickets,
  getEnquiries,
  getTicketById,
  updateTicket,
  updateEnquiry,
};

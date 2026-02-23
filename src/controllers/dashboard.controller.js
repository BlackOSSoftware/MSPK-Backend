import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import { dashboardService } from '../services/index.js';

const getStats = catchAsync(async (req, res) => {
  const stats = await dashboardService.getAdminStats();
  res.send(stats);
});

const createTicket = catchAsync(async (req, res) => {
    // Initial message construction
    const initialMessage = {
        sender: 'USER',
        message: req.body.message,
        attachments: req.body.attachments
    };
    const ticketBody = {
        subject: req.body.subject,
        category: req.body.category,
        priority: req.body.priority || 'MEDIUM',
        initialMessage
    };
    const ticket = await dashboardService.createTicket(ticketBody, req.user);
    res.status(httpStatus.CREATED).send(ticket);
});

const getMyTickets = catchAsync(async (req, res) => {
    const tickets = await dashboardService.getTickets({ user: req.user.id });
    res.send(tickets);
});

const getAllTickets = catchAsync(async (req, res) => {
    const filter = req.query.status ? { status: req.query.status } : {};
    const tickets = await dashboardService.getTickets(filter);
    res.send(tickets);
});

const replyTicket = catchAsync(async (req, res) => {
    const sender = req.user.role === 'admin' ? 'ADMIN' : 'USER';
    const messageData = {
        sender,
        message: req.body.message,
        attachments: req.body.attachments
    };
    const ticket = await dashboardService.replyToTicket(req.params.ticketId, messageData);
    res.send(ticket);
});

export default {
  getStats,
  createTicket,
  getMyTickets,
  getAllTickets,
  replyTicket
};

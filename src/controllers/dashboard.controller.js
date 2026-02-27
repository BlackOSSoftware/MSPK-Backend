import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import { dashboardService } from '../services/index.js';

const getStats = catchAsync(async (req, res) => {
  const stats = await dashboardService.getAdminStats();
  res.send(stats);
});

const createTicket = catchAsync(async (req, res) => {
    const ticketBody = {
        subject: req.body.subject,
        ticketType: req.body.ticketType,
        description: req.body.description,
        contactEmail: req.body.contactEmail,
        contactNumber: req.body.contactNumber
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

export default {
  getStats,
  createTicket,
  getMyTickets,
  getAllTickets
};

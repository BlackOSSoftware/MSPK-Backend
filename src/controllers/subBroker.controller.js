import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import { subBrokerService } from '../services/index.js';

const createSubBroker = catchAsync(async (req, res) => {
    const subBroker = await subBrokerService.createSubBroker(req.body);
    res.status(httpStatus.CREATED).send(subBroker);
});

const getSubBrokers = catchAsync(async (req, res) => {
    // Filter logic can be added here if needed
    const filter = {};
    const result = await subBrokerService.getSubBrokers(filter);
    res.send(result);
});

import Subscription from '../models/Subscription.js';

const getSubBrokerDetails = catchAsync(async (req, res) => {
    const subBroker = await subBrokerService.getSubBrokerById(req.params.subBrokerId);
    if (!subBroker) {
        return res.status(httpStatus.NOT_FOUND).send({ message: 'Sub Broker not found' });
    }
    
    // Fetch raw clients
    const rawClients = await subBrokerService.getSubBrokerClients(req.params.subBrokerId);
    
    // Enrich clients with Subscription Data (Similar to Admin Controller)
    const clients = await Promise.all(rawClients.map(async (u) => {
        const sub = await Subscription.findOne({ user: u.id, status: 'active' }).populate('plan');
        return {
            id: u.id,
            name: u.name,
            email: u.email,
            phone: u.phone || '',
            
            // Subscription / Plan Data
            plan: (sub && sub.plan) ? sub.plan.name : (u.subscription && u.subscription.plan ? u.subscription.plan : 'Free'), 
            planStatus: sub ? 'Active' : 'Inactive',
            subscriptionStart: sub ? sub.startDate : null,
            subscriptionExpiry: sub ? sub.endDate : null,

            // Stats
            status: u.status || 'Active', 
            equity: u.equity || 0,
            walletBalance: u.walletBalance || 0,
            clientId: u.clientId || `MS-${u.id.toString().slice(-4)}`,
            
            joinDate: u.createdAt,
        };
    }));

    const commissions = await subBrokerService.getCommissions(req.params.subBrokerId);
    res.send({ subBroker, clients, commissions });
});

const updateSubBroker = catchAsync(async (req, res) => {
    const subBroker = await subBrokerService.updateSubBrokerById(req.params.subBrokerId, req.body);
    res.send(subBroker);
});

const deleteSubBroker = catchAsync(async (req, res) => {
    await subBrokerService.deleteSubBrokerById(req.params.subBrokerId);
    res.status(httpStatus.NO_CONTENT).send();
});

// For Sub-Broker Self View (Legacy/Auth Compat)
const getMyClients = catchAsync(async (req, res) => {
    const clients = await subBrokerService.getSubBrokerClients(req.user.id);
    res.send(clients);
});

const getMyCommissions = catchAsync(async (req, res) => {
    const commissions = await subBrokerService.getCommissions(req.user.id);
    res.send(commissions);
});

const processPayout = catchAsync(async (req, res) => {
    const result = await subBrokerService.processPayout(req.params.subBrokerId);
    res.send({ message: 'Payout processed successfully', result });
});

export default {
  createSubBroker,
  getSubBrokers,
  getSubBrokerDetails,
  updateSubBroker,
  deleteSubBroker,
  getMyClients,
  getMyCommissions,
  processPayout
};

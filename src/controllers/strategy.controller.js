import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import Strategy from '../models/Strategy.js';

import strategyService from '../services/strategy.service.js';

const createStrategy = catchAsync(async (req, res) => {
    const strategy = await Strategy.create({
        ...req.body,
        user: req.user.id // Assign creator
    });
    strategyService.reloadStrategies();
    res.status(httpStatus.CREATED).send(strategy);
});

const getStrategies = catchAsync(async (req, res) => {
    // Admin sees all? Or user sees theirs? For now, fetch all.
    const strategies = await Strategy.find().sort({ isSystem: -1, createdAt: -1 });
    res.send(strategies);
});

const seedStrategies = catchAsync(async (req, res) => {
    const result = await strategyService.seedStrategies(req.user);
    res.status(httpStatus.CREATED).send(result);
});

const updateStrategy = catchAsync(async (req, res) => {
    // Protection Removed as per User Request for Full Control
    const strategy = await Strategy.findByIdAndUpdate(req.params.strategyId, req.body, { new: true });
    if (!strategy) {
        throw new Error('Strategy not found'); 
    }
    strategyService.reloadStrategies();
    res.send(strategy);
});

const deleteStrategy = catchAsync(async (req, res) => {
    // Protection Removed
    await Strategy.findByIdAndDelete(req.params.strategyId);
    strategyService.reloadStrategies();
    res.status(httpStatus.NO_CONTENT).send();
});

export default {
    createStrategy,
    getStrategies,
    updateStrategy,
    deleteStrategy,
    seedStrategies
};

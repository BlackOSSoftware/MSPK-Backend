import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import analyticsService from '../services/analytics.service.js';

const getAnalytics = catchAsync(async (req, res) => {
    const { type, range } = req.query; // type: 'revenue' | 'subscription' | 'signals'
    
    let data;
    if (type === 'revenue') {
        data = await analyticsService.getRevenueAnalytics(range);
    } else if (type === 'subscription') {
        data = await analyticsService.getSubscriptionAnalytics(range);
    } else if (type === 'signals') {
        data = await analyticsService.getSignalPerformance(range);
    } else {
        // Default to revenue if unspecified
        data = await analyticsService.getRevenueAnalytics('month');
    }
    
    res.send(data);
});

const exportAnalytics = catchAsync(async (req, res) => {
    const { type, range } = req.query;
    const csvData = await analyticsService.getAnalyticsCSV(type || 'revenue', range || 'month');
    
    res.header('Content-Type', 'text/csv');
    res.attachment(`analytics-${type}-${range}-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csvData);
});

export default {
    getAnalytics,
    exportAnalytics
};

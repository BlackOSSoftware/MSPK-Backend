import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import Signal from '../models/Signal.js';
import Ticket from '../models/Ticket.js';
import { startOfMonth, subMonths, startOfYear, startOfQuarter, endOfDay, subDays } from 'date-fns';
/**
 * Helper to get date range
 * @param {string} range 'month' | 'quarter' | 'year'
 */
const getDateRange = (range) => {
    const now = new Date();
    let startDate;
    if (range === 'quarter') startDate = startOfQuarter(now);
    else if (range === 'year') startDate = startOfYear(now);
    else startDate = startOfMonth(now); // default 'month'
    
    return { start: startDate, end: now };
};

const getRevenueAnalytics = async (range) => {
    const { start, end } = getDateRange(range);
    
    // 1. Total Revenue (Sum of all successful DEBIT transactions which imply payment to platform)
    // Note: Assuming 'DEBIT' transactions with purpose 'SUBSCRIPTION' are revenue.
    const revenueAgg = await Transaction.aggregate([
        {
            $match: {
                status: 'success',
                type: 'DEBIT', 
                createdAt: { $gte: start, $lte: end }
            }
        },
        {
            $group: {
                _id: null,
                total: { $sum: '$amount' },
                count: { $sum: 1 }
            }
        }
    ]);
    const totalRevenue = revenueAgg[0]?.total || 0;

    // 2. Previous Period for Change % (Mock logic for now, or real comp)
    // For simplicity, we'll calculate change based on a simple linear projection or random factor if no prev data
    // Real implementation would repeat aggression for [start - diff, start]
    
    // 3. Avg Revenue per User
    const totalUsers = await User.countDocuments({ role: 'user' });
    const avgRevenue = totalUsers ? Math.round(totalRevenue / totalUsers) : 0;

    // 4. Refunds (Mocking as 0 for now as no explicit REFUND type in Transaction)
    const refunds = 0; 
    
    // 5. Protected (Simple +20% of current)
    const projected = Math.round(totalRevenue * 1.2);

    // 6. Graph Data (Group by Day)
    const graphDataAgg = await Transaction.aggregate([
        {
            $match: {
                status: 'success',
                type: 'DEBIT',
                createdAt: { $gte: start, $lte: end }
            }
        },
        {
            $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                value: { $sum: '$amount' }
            }
        },
        { $sort: { _id: 1 } }
    ]);
    
    return {
        cards: {
            totalRevenue: { value: totalRevenue, change: 12.5 }, // Mock change
            avgRevenue: { value: avgRevenue, change: 2.1 },
            refunds: { value: refunds, change: -5.4 },
            projected: { value: projected, change: 8.2 }
        },
        graph: graphDataAgg.map(g => ({ date: g._id, value: g.value }))
    };
};

const getSubscriptionAnalytics = async (range) => {
    const { start, end } = getDateRange(range);

    // 1. New Subscribers (Created in range)
    const newSubsCount = await Subscription.countDocuments({
        createdAt: { $gte: start, $lte: end }
    });

    // 2. Churned (Canceled/Expired in range - checking updatedAt as proxy for cancellation time)
    // Note: status change usually updates 'updatedAt'
    const churnedCount = await Subscription.countDocuments({
        status: { $in: ['canceled', 'expired'] },
        updatedAt: { $gte: start, $lte: end }
    });

    // 3. Active Plans (Current Snapshot)
    const activePlansCount = await Subscription.countDocuments({ status: 'active' });

    // 4. Churn Rate & Retention
    const totalConsidered = activePlansCount + churnedCount;
    const churnRate = totalConsidered > 0 ? ((churnedCount / totalConsidered) * 100).toFixed(1) : 0;
    const retention = (100 - churnRate).toFixed(1);

    // 5. Graph Data (Group by Date)
    const graphAgg = await Subscription.aggregate([
        {
            $match: {
                createdAt: { $gte: start, $lte: end }
            }
        },
        {
            $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                newUsers: { $sum: 1 },
                // Note: Churned per day is harder without a separate events table, 
                // so we might just project 0 or try to match updatedAt if needed.
                // For now, let's keep churned 0 in graph to avoid complex $lookup or 2nd query merge
                churned: { $sum: 0 } 
            }
        },
        { $sort: { _id: 1 } }
    ]);

    // Map graph data to expected format
    const graphData = graphAgg.map(g => ({
        time: new Date(g._id).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        newUsers: g.newUsers,
        churned: g.churned || 0 
    }));
    
    // If no data, return empty array (handled by frontend) or a zero-filled array if prefered
    
    return {
        cards: {
            newSubscribers: { value: newSubsCount, change: 0 }, // TODO: Calc change vs prev period
            churnRate: { value: churnRate, change: 0 },
            activePlans: { value: activePlansCount, change: 0 },
            retention: { value: retention, change: 0 }
        },
        graph: graphData
    };
};

const getSignalPerformance = async (range) => {
    const { start, end } = getDateRange(range);

    // 1. Aggregation for Stats
    const statsAgg = await Signal.aggregate([
        { 
            $match: { 
                createdAt: { $gte: start, $lte: end },
                status: { $in: ['Target Hit', 'Stoploss Hit', 'Closed'] } // Only closed/finished signals
            } 
        },
        {
            $group: {
                _id: null,
                totalSignals: { $sum: 1 },
                wins: { 
                    $sum: { 
                        $cond: [{ $eq: ["$status", "Target Hit"] }, 1, 0]
                    }
                }
            }
        }
    ]);

    const stats = statsAgg[0] || { totalSignals: 0, wins: 0 };
    const totalProfit = 0;
    const winRate = stats.totalSignals > 0 ? ((stats.wins / stats.totalSignals) * 100).toFixed(1) : 0;
    const avgProfit = stats.totalSignals > 0 ? (totalProfit / stats.totalSignals).toFixed(2) : 0; // Avg PnL per trade

    // 2. Loss Streak (Mock or Simple check of last N)
    // Fetch last 10 closed signals desc
    const lastSignals = await Signal.find({ 
        status: { $in: ['Target Hit', 'Stoploss Hit', 'Closed'] } 
    }).sort({ createdAt: -1 }).limit(10);

    let currentLossStreak = 0;
    for (let s of lastSignals) {
        if (s.status === 'Stoploss Hit') {
            currentLossStreak++;
        } else {
            break; 
        }
    }

    // 3. Graph Data (Avg Accuracy per day/week is hard, using Volume & Win Count)
    const graphAgg = await Signal.aggregate([
        {
            $match: {
                createdAt: { $gte: start, $lte: end },
                status: { $in: ['Target Hit', 'Stoploss Hit', 'Closed'] }
            }
        },
        {
            $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                volume: { $sum: 1 },
                wins: { 
                    $sum: { 
                        $cond: [{ $eq: ["$status", "Target Hit"] }, 1, 0]
                    }
                }
            }
        },
        { $sort: { _id: 1 } }
    ]);

    const graph = graphAgg.map(g => ({
        time: new Date(g._id).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        volume: g.volume,
        accuracy: g.volume > 0 ? Math.round((g.wins / g.volume) * 100) : 0
    }));

    return {
        cards: {
            winRate: { value: winRate, change: 0 },
            totalSignals: { value: stats.totalSignals, change: 0 },
            avgProfit: { value: avgProfit, change: 0 },
            lossStreak: { value: currentLossStreak, change: 0 }
        },
        graph: graph
    };
};

/**
 * Generate CSV string from analytics data
 * @param {string} type 
 * @param {string} range 
 */
const getAnalyticsCSV = async (type, range) => {
    let data;
    let csvContent = "";

    if (type === 'revenue') {
        data = await getRevenueAnalytics(range);
        csvContent = "Date,Revenue\n";
        data.graph.forEach(row => {
            csvContent += `${row.date},${row.value}\n`;
        });
        // Append Summary
        csvContent += `\nSummary\nTotal Revenue,${data.cards.totalRevenue.value}\nAvg Revenue/User,${data.cards.avgRevenue.value}\n`;
    
    } else if (type === 'subscription') {
        data = await getSubscriptionAnalytics(range);
        csvContent = "Date,New Subscribers,Churned\n";
        // Mock Graph data loop would go here, currently empty
        csvContent += `\nSummary\nNew Subscribers,${data.cards.newSubscribers.value}\nActive Plans,${data.cards.activePlans.value}\n`;

    } else if (type === 'signals') {
        data = await getSignalPerformance(range);
        csvContent = "Date,Win Rate,Total Signals\n";
        // Mock Graph data loop would go here
        csvContent += `\nSummary\nWin Rate,${data.cards.winRate.value}%\nTotal Signals,${data.cards.totalSignals.value}\n`;
    }

    return csvContent;
};

export default {
    getRevenueAnalytics,
    getSubscriptionAnalytics,
    getSignalPerformance,
    getAnalyticsCSV
};

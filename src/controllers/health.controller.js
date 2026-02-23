import os from 'os';

import catchAsync from '../utils/catchAsync.js';

// Helper to get CPU avg
const getCpuAverage = () => {
    const cpus = os.cpus();
    let idleMs = 0;
    let totalMs = 0;

    cpus.forEach((core) => {
        for (const type in core.times) {
            totalMs += core.times[type];
        }
        idleMs += core.times.idle;
    });

    return {
        idle: idleMs / cpus.length,
        total: totalMs / cpus.length,
    };
};

const getSystemHealth = catchAsync(async (req, res) => {
    console.log('Health Check API hit (Native)');
    try {
        const startMeasure = getCpuAverage();

        // Wait 100ms to calculate difference
        setTimeout(() => {
            const endMeasure = getCpuAverage();
            const idleDifference = endMeasure.idle - startMeasure.idle;
            const totalDifference = endMeasure.total - startMeasure.total;
            const percentage = totalDifference === 0 ? 0 : 100 - (100 * idleDifference / totalDifference);

            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const memPercent = (usedMem / totalMem) * 100;

            res.send({
                serverLoad: percentage.toFixed(1),
                memoryUsage: memPercent.toFixed(1),
                uptime: os.uptime(),
                status: 'LIVE'
            });
        }, 1000); // 1 second sample for better accuracy

    } catch (error) {
        console.error('Error in Health API:', error);
        throw error;
    }
});

export default {
    getSystemHealth
};

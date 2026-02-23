import metricsCollector from '../monitoring/metricsCollector.js';

export const metricsMiddleware = (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        metricsCollector.trackApiRequest(duration);
        
        if (res.statusCode === 429) {
            metricsCollector.track429();
        }
    });

    next();
};

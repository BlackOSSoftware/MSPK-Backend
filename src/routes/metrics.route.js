import express from 'express';
import metricsCollector from '../monitoring/metricsCollector.js';
import alertManager from '../monitoring/alertManager.js';

const router = express.Router();

/**
 * GET /metrics
 * Returns JSON metrics for the Dashboard
 */
router.get('/', (req, res) => {
    const snapshot = metricsCollector.getSnapshot();
    res.json(snapshot);
});

/**
 * GET /metrics/alerts
 * Returns recent alerts
 */
router.get('/alerts', (req, res) => {
    res.json(alertManager.getHistory());
});

/**
 * GET /metrics/prometheus
 * Returns Prometheus-formatted metrics
 */
router.get('/prometheus', (req, res) => {
    const data = metricsCollector.getSnapshot();
    let text = '';
    
    // API
    text += `# HELP api_req_per_min API Requests Per Minute\n`;
    text += `# TYPE api_req_per_min gauge\n`;
    text += `api_req_per_min ${data.api.requests_per_minute}\n`;
    
    // Cache
    text += `cache_hit_rate ${data.derived.cache_hit_rate}\n`;
    
    res.set('Content-Type', 'text/plain');
    res.send(text);
});

export default router;

import logger from '../config/log.js';

class AlertManager {
    constructor() {
        this.alerts = [];
    }

    /**
     * Trigger an alert
     * @param {string} severity - 'INFO' | 'WARNING' | 'CRITICAL'
     * @param {string} message 
     * @param {Object} metadata 
     */
    trigger(severity, message, metadata = {}) {
        const alert = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            severity,
            message,
            metadata
        };

        this.alerts.push(alert);
        if (this.alerts.length > 100) this.alerts.shift();

        this._dispatch(alert);
    }

    _dispatch(alert) {
        // Log to Console
        if (alert.severity === 'CRITICAL') {
            logger.error(`[ALERT] ${alert.message}`, alert.metadata);
            // TODO: Integrations (Slack/Email) would go here
        } else {
            logger.warn(`[ALERT] ${alert.message}`, alert.metadata);
        }
    }

    getHistory() {
        return this.alerts;
    }
}

export default new AlertManager();

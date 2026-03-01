import { EventEmitter } from 'events';
import WebSocket from 'ws';
import logger from '../config/log.js';

/**
 * @typedef {Object} ConnectionOptions
 * @property {string} url - WebSocket URL
 * @property {string} [name='AvailableSocket'] - Connection identifier
 * @property {number} [maxRetries=10] - Max reconnect attempts
 * @property {number} [baseBackoff=1000] - Initial retry delay (ms)
 * @property {number} [maxBackoff=30000] - Max retry delay (ms)
 * @property {number} [heartbeatInterval=30000] - Ping interval (ms)
 */

class ConnectionPool extends EventEmitter {
    constructor(maxConnections = 5) {
        super();
        this.maxConnections = maxConnections;
        /** @type {Map<string, WebSocket>} */
        this.connections = new Map();
        /** @type {Map<string, Object>} */
        this.metadata = new Map();
        // WeakMap to associate listeners with sockets for precise cleanup
        this.listeners = new WeakMap(); 
        this.isShuttingDown = false;
    }

    /**
     * Get or create a managed connection
     * @param {string} id - Unique identifier for the connection
     * @param {ConnectionOptions} options
     * @returns {Promise<WebSocket>}
     */
    async getConnection(id, options) {
        if (this.connections.has(id)) {
            const ws = this.connections.get(id);
            if (ws.readyState === WebSocket.OPEN) return ws;
            // If closed/closing, remove and recreate
            this.removeConnection(id);
        }

        if (this.connections.size >= this.maxConnections) {
            throw new Error(`Connection pool limit reached (${this.maxConnections})`);
        }

        return this._createConnection(id, options);
    }

    _createConnection(id, options) {
        const { url, maxRetries = 10, baseBackoff = 1000, maxBackoff = 30000 } = options;
        
        logger.info(`[Pool] Creating connection: ${id}`);
        
        try {
            const ws = new WebSocket(url);
            
            // Metadata for recovery (preserve retries across reconnects)
            const prevMeta = this.metadata.get(id);
            if (prevMeta?.reconnectTimer) clearTimeout(prevMeta.reconnectTimer);
            this.metadata.set(id, { 
                options, 
                retries: prevMeta?.retries ?? 0, 
                reconnectTimer: null,
                heartbeatTimer: null,
                isAlive: true,
                stopReconnect: prevMeta?.stopReconnect ?? false
            });

            this.connections.set(id, ws);

            // Store bound listeners to allow precise removal
            const handlers = {
                open: () => this._handleOpen(id, ws),
                close: (code, reason) => this._handleClose(id, ws, code, reason),
                error: (err) => this._handleError(id, ws, err),
                message: (data) => this.emit(`message:${id}`, data),
                pong: () => {
                    const meta = this.metadata.get(id);
                     if(meta) meta.isAlive = true; 
                }
            };

            this.listeners.set(ws, handlers);

            // Bind Events
            ws.on('open', handlers.open);
            ws.on('close', handlers.close);
            ws.on('error', handlers.error);
            ws.on('message', handlers.message);
            ws.on('pong', handlers.pong);

            return ws;
        } catch (error) {
            logger.error(`[Pool] Creation failed for ${id}: ${error.message}`);
            this._scheduleReconnect(id);
        }
    }

    _handleOpen(id, ws) {
        logger.info(`[Pool] Connected: ${id}`);
        const meta = this.metadata.get(id);
        if (meta) {
            meta.retries = 0;
            meta.isAlive = true;
            
            // Fix: Check for undefined specifically so 0 is respected.
            const interval = meta.options.heartbeatInterval !== undefined 
                ? meta.options.heartbeatInterval 
                : 30000;
                
            this._startHeartbeat(id, ws, interval);
        }
        this.emit(`open:${id}`);
        this.emit('connect', id);
    }

    _handleClose(id, ws, code, reason) {
        if (this.isShuttingDown) return;
        logger.warn(`[Pool] Closed: ${id} (Code: ${code}, Reason: ${reason})`);
        this._cleanupConnection(id, ws);
        this._scheduleReconnect(id);
        this.emit(`close:${id}`, { code, reason });
    }

    _handleError(id, ws, error) {
        const errorMessage = error?.message || String(error);
        if (/\b(401|403)\b/.test(errorMessage)) {
            const meta = this.metadata.get(id);
            if (meta) meta.stopReconnect = true;
            logger.error(`[Pool] Auth error for ${id}. Reconnect disabled. (${errorMessage})`);
            this.emit(`error:${id}`, error);
            return;
        }
        if (errorMessage.includes('429')) {
            logger.warn(`[Pool] 429 Rate Limit detected for ${id}. Applying search cool-down.`);
            const meta = this.metadata.get(id);
            if (meta) {
                 meta.retries = Math.max(meta.retries, 5); // Jump to high backoff
            }
        }
        logger.error(`[Pool] Error in ${id}: ${errorMessage}`);
        this.emit(`error:${id}`, error);
    }

    _cleanupConnection(id, ws) {
        // Stop heartbeat
        const meta = this.metadata.get(id);
        if (meta && meta.heartbeatTimer) clearInterval(meta.heartbeatTimer);

        // Remove listeners explicitly to prevent leaks
        const handlers = this.listeners.get(ws);
        if (handlers) {
            ws.removeListener('open', handlers.open);
            ws.removeListener('close', handlers.close);
            ws.removeListener('error', handlers.error);
            ws.removeListener('message', handlers.message);
            ws.removeListener('pong', handlers.pong);
            this.listeners.delete(ws);
        }

        // Force terminate if still open
        try {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.terminate();
            }
        } catch (e) { /* ignore */ }

        this.connections.delete(id);
    }

    _scheduleReconnect(id) {
        const meta = this.metadata.get(id);
        if (!meta || this.isShuttingDown) return;

        if (meta.stopReconnect) {
            logger.error(`[Pool] Reconnect disabled for ${id}.`);
            this.emit(`failed:${id}`);
            this.metadata.delete(id);
            return;
        }

        if (meta.reconnectTimer) return; // Avoid duplicate timers

        if (meta.retries >= (meta.options.maxRetries || 10)) {
            logger.error(`[Pool] Max retries reached for ${id}. Giving up.`);
            this.emit(`failed:${id}`);
            this.metadata.delete(id);
            return;
        }

        // Exponential backoff with jitter
        const delay = Math.min(
            meta.options.baseBackoff * Math.pow(2, meta.retries),
            meta.options.maxBackoff
        );
        const jitter = Math.random() * 1000;
        const finalDelay = delay + jitter;

        logger.info(`[Pool] Reconnecting ${id} in ${Math.round(finalDelay)}ms (Attempt ${meta.retries + 1})`);

        meta.reconnectTimer = setTimeout(() => {
            meta.reconnectTimer = null;
            meta.retries++;
            this._createConnection(id, meta.options);
        }, finalDelay);
    }

    _startHeartbeat(id, ws, interval) {
        if (interval <= 0) return; // Disable heartbeat if interval is 0 or negative
        
        const meta = this.metadata.get(id);
        if (!meta) return;

        if (meta.heartbeatTimer) clearInterval(meta.heartbeatTimer);

        meta.heartbeatTimer = setInterval(() => {
            if (!meta.isAlive) {
                logger.warn(`[Pool] Heartbeat failed for ${id}. Terminating.`);
                ws.terminate(); // Will trigger 'close' logic
                return;
            }

            meta.isAlive = false;
            // Native Ping (if using 'ws' library)
            if (ws.ping) {
                ws.ping();
            } else {
                // Fallback for browser-like sockets if needed, but 'ws' has ping
                meta.isAlive = true; 
            }
        }, interval);
    }

    removeConnection(id) {
        const ws = this.connections.get(id);
        const meta = this.metadata.get(id);
        
        if (meta?.reconnectTimer) clearTimeout(meta.reconnectTimer);
        
        if (ws) {
            this._cleanupConnection(id, ws);
        }
        
        this.metadata.delete(id);
    }

    shutdown() {
        this.isShuttingDown = true;
        for (const id of this.connections.keys()) {
            this.removeConnection(id);
        }
    }
}

// Singleton export
export const connectionPool = new ConnectionPool();
export default ConnectionPool;

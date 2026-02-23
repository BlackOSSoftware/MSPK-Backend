import logger from '../config/logger.js';

class MetricsCollector {
    constructor() {
        this.metrics = {
            api: {
                requests_per_minute: 0,
                errors_429: 0,
                latency_sum: 0,
                latency_count: 0
            },
            cache: {
                hits: 0,
                misses: 0,
                keys: 0
            },
            websocket: {
                connections: 0,
                messages_sent_sec: 0,
                queue_length: 0
            },
            system: {
                memory_usage_mb: 0,
                uptime: 0
            }
        };

        // Rotation History (Last 60 mins)
        this.history = [];
        
        // Reset Counters every minute
        setInterval(() => this.rotateMetrics(), 60000);
        
        // Reset Rate Counters every second (for "per second" metrics)
        setInterval(() => {
            this.metrics.websocket.messages_sent_sec = 0;
        }, 1000);
    }

    // --- API Hook ---
    trackApiRequest(durationMs) {
        this.metrics.api.requests_per_minute++;
        this.metrics.api.latency_sum += durationMs;
        this.metrics.api.latency_count++;
    }

    track429() {
        this.metrics.api.errors_429++;
    }

    // --- Cache Hook ---
    trackCache(hit) {
        if (hit) this.metrics.cache.hits++;
        else this.metrics.cache.misses++;
    }

    // --- WS Hook ---
    updateWsConnections(count) {
        this.metrics.websocket.connections = count;
    }

    trackWsMessage() {
        this.metrics.websocket.messages_sent_sec++;
    }

    updateQueueLength(len) {
        this.metrics.websocket.queue_length = len;
    }

    // --- System ---
    getSnapshot() {
        const mem = process.memoryUsage();
        this.metrics.system.memory_usage_mb = Math.round(mem.heapUsed / 1024 / 1024);
        this.metrics.system.uptime = process.uptime();
        
        // Calculated/Derived
        const cacheTotal = this.metrics.cache.hits + this.metrics.cache.misses;
        const cacheHitRate = cacheTotal > 0 ? (this.metrics.cache.hits / cacheTotal) * 100 : 0;
        
        const avgLatency = this.metrics.api.latency_count > 0 
            ? Math.round(this.metrics.api.latency_sum / this.metrics.api.latency_count) 
            : 0;

        return {
            timestamp: Date.now(),
            ...this.metrics,
            derived: {
                cache_hit_rate: parseFloat(cacheHitRate.toFixed(1)),
                avg_api_latency: avgLatency
            }
        };
    }

    rotateMetrics() {
        const snapshot = this.getSnapshot();
        
        // Check Alerts (Simple Hook)
        this._checkAlerts(snapshot);

        // Store History
        this.history.push(snapshot);
        if (this.history.length > 60) this.history.shift();

        // Reset Counters
        this.metrics.api.requests_per_minute = 0;
        this.metrics.api.errors_429 = 0;
        this.metrics.api.latency_sum = 0;
        this.metrics.api.latency_count = 0;
        // Cache misses/hits accumulate or reset? Let's accumulate for lifetime or reset?
        // Let's reset to track "Hit Rate Per Minute"
        this.metrics.cache.hits = 0;
        this.metrics.cache.misses = 0;
    }

    _checkAlerts(data) {
        const { api, derived, websocket } = data;
        
        // 1. 429 Errors
        if (api.errors_429 > 0) {
            logger.error(`[ALERT] CRITICAL: ${api.errors_429} 429 Errors detected in last minute!`);
        }

        // 2. Cache Hit Rate
        if (derived.cache_hit_rate < 50 && (api.requests_per_minute > 10)) {
            logger.warn(`[ALERT] WARNING: Cache Hit Rate Low: ${derived.cache_hit_rate}%`);
        }

        // 3. Queue Length
        if (websocket.queue_length > 20) {
            logger.warn(`[ALERT] WARNING: Request Queue Length High: ${websocket.queue_length}`);
        }
    }
}

export default new MetricsCollector();

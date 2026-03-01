import EventEmitter from 'events';
import logger from '../config/log.js';

const DEBUG_QUEUE = process.env.DEBUG_QUEUE === 'true';
const ENABLE_QUEUE_MONITOR = process.env.ENABLE_QUEUE_MONITOR === 'true';

class RequestQueue extends EventEmitter {
    constructor(requestsPerMinute = 50) {
        super();
        this.requestsPerMinute = requestsPerMinute;
        this.intervalMs = (60000 / this.requestsPerMinute) * 1.2; // 1.2x safety buffer
        this.lastRequestTime = 0;
        
        // Queues by priority
        this.queues = {
            1: [], // Realtime (High)
            2: [], // Historical (Medium)
            3: []  // Bulk (Low)
        };

        this.pendingRequests = new Map(); // Key -> Promise
        this.isProcessing = false;
        this.currentJobKey = null; // Track current job
        
        // Stuck Job Detector
        if (ENABLE_QUEUE_MONITOR) {
            setInterval(() => {
                if (this.isProcessing && this.currentJobKey) {
                    const now = Date.now();
                    if (now - this.lastRequestTime > 15000) { // 15s Threshold
                        logger.warn(`[RequestQueue-Monitor] QUEUE STUCK on Job: ${this.currentJobKey} for ${(now - this.lastRequestTime)/1000}s`);
                    }
                }
            }, 5000);
        }
        
        // Metrics
        this.metrics = {
            totalRequests: 0,
            processed: 0,
            deduplicated: 0,
            errors: 0,
            rateLimited: 0,
            startTime: Date.now()
        };
    }

    /**
     * Add a request to the queue
     * @param {string} key - Unique key for deduplication
     * @param {Function} task - Async function to execute
     * @param {number} priority - 1 (High) to 3 (Low)
     * @returns {Promise}
     */
    add(key, task, priority = 2) {
        // 1. Deduplication
        if (this.pendingRequests.has(key)) {
            this.metrics.deduplicated++;
            return this.pendingRequests.get(key);
        }

        // 2. Create Promise Wrapper
        const promise = new Promise((resolve, reject) => {
            const wrappedTask = {
                key,
                task,
                resolve,
                reject,
                attempts: 0,
                addedAt: Date.now()
            };
            
            if (DEBUG_QUEUE) logger.debug(`[RequestQueue] Added: ${key} (Priority ${priority})`);

            // Add to appropriate queue
            if (!this.queues[priority]) priority = 2;
            this.queues[priority].push(wrappedTask);
            this.metrics.totalRequests++;
        });

        // 3. Store Promise for deduplication
        this.pendingRequests.set(key, promise);
        
        // 4. Cleanup on completion
        promise.finally(() => {
            this.pendingRequests.delete(key);
        });

        // 5. Trigger Processing
        this.process();

        return promise;
    }

    async process() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        if (DEBUG_QUEUE) logger.debug(`[RequestQueue] Starting Process Loop`);

        while (this.hasRequests()) {
            const now = Date.now();
            const timeSinceLast = now - this.lastRequestTime;
            
            // Rate Limiting Wait
            if (timeSinceLast < this.intervalMs) {
                const wait = this.intervalMs - timeSinceLast;
                await new Promise(r => setTimeout(r, wait));
            }

            // Check Pause
            if (this.pausedUntil && Date.now() < this.pausedUntil) {
                const wait = this.pausedUntil - Date.now();
                await new Promise(r => setTimeout(r, wait));
                this.pausedUntil = 0; // Clear after waiting
            }

            // Get next task (Priority 1 -> 2 -> 3)
            const job = this.getNextJob();
            if (!job) break;

            this.lastRequestTime = Date.now();

            try {
                this.currentJobKey = job.key;
                if (DEBUG_QUEUE) logger.debug(`[RequestQueue] Executing Job: ${job.key}`);
                const result = await job.task();
                this.metrics.processed++;
                job.resolve(result);
            } catch (error) {
                // Rate Limit Handling (429)
                if (error.response && error.response.status === 429) {
                    this.metrics.rateLimited++;
                    job.attempts++;
                    
                    if (job.attempts <= 3) {
                        // Exponential Backoff: 2^attempts * 1000ms
                        const backoff = Math.pow(2, job.attempts) * 1000;
                        logger.warn(`[RequestQueue] 429 Hit. Retrying ${job.key} in ${backoff}ms (Attempt ${job.attempts})`);
                        
                        await new Promise(r => setTimeout(r, backoff));
                        
                        // Re-add to front of high priority queue to retry ASAP
                        this.queues[1].unshift(job); 
                    } else {
                        logger.error(`[RequestQueue] Max retries reached for ${job.key}`);
                        this.metrics.errors++;
                        job.reject(error);
                    }
                } else {
                    logger.error(`[RequestQueue] Job Failed ${job.key}: ${error.message}`);
                    this.metrics.errors++;
                    job.reject(error);
                }
            } finally {
                 if (DEBUG_QUEUE) logger.debug(`[RequestQueue] Job Finished: ${job.key}`);
                 this.currentJobKey = null;
            }
        }

        this.isProcessing = false;
        if (DEBUG_QUEUE) logger.debug(`[RequestQueue] Loop Ended. Pending: ${this.pendingRequests.size}`);
    }

    hasRequests() {
        return this.queues[1].length > 0 || this.queues[2].length > 0 || this.queues[3].length > 0;
    }

    getNextJob() {
        if (this.queues[1].length > 0) return this.queues[1].shift();
        if (this.queues[2].length > 0) return this.queues[2].shift();
        if (this.queues[3].length > 0) return this.queues[3].shift();
        return null;
    }

    getStats() {
        const uptimeMinutes = (Date.now() - this.metrics.startTime) / 60000;
        return {
            pending: this.queues[1].length + this.queues[2].length + this.queues[3].length,
            rpm: uptimeMinutes > 0 ? (this.metrics.processed / uptimeMinutes).toFixed(2) : 0,
            dedupStats: `${this.metrics.deduplicated}/${this.metrics.totalRequests}`,
            activePromises: this.pendingRequests.size,
            conf: {
                interval: this.intervalMs.toFixed(0) + 'ms',
                limit: this.requestsPerMinute
            }
        };
    }

    emergencyThrottle() {
        console.warn('[RequestQueue] Emergency Throttle Activated!');
        this.requestsPerMinute = 30;
        this.intervalMs = (60000 / 30) * 1.2;
    }

    /**
     * Pause the queue processing for a duration
     * @param {number} durationMs 
     */
    pause(durationMs) {
        console.warn(`[RequestQueue] PAUSED for ${durationMs / 1000}s`);
        this.pausedUntil = Date.now() + durationMs;
    }
}

// Singleton Instance
const requestQueue = new RequestQueue();

export default requestQueue;

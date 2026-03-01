import { RingBuffer } from './RingBuffer.js';

class DataPipeline {
    constructor() {
        this.buffers = {
            high: new RingBuffer(20000), // Active symbols
            normal: new RingBuffer(50000), // Other subscribed
            low: new RingBuffer(10000)   // Background updates
        };
        
        this.activeSymbols = new Set();
        this.lastPriceMap = new Map(); // For deduplication
        
        this.wasmFilter = null; // Placeholder for WASM instance
        this.isRunning = false;
        this._draining = false;
        this._drainScheduled = false;
        
        // Stats
        this.metrics = {
            in: 0,
            out: 0,
            dropped: 0,
            dupes: 0
        };
    }

    start(broadcaster) {
        this.broadcaster = broadcaster; // Logic to actually send data (ws service)
        this.isRunning = true;
        this._scheduleDrain();
    }
    
    stop() {
        this.isRunning = false;
    }

    setActiveSymbols(symbols) {
        this.activeSymbols = new Set(symbols);
    }

    push(tick) {
        this.metrics.in++;
        
        // 1. Data Filter (WASM or JS Fallback)
        if (this.wasmFilter) {
             if (!this.wasmFilter.isValid(tick.price, tick.volume)) {
                 this.metrics.dropped++;
                 return;
             }
        } else {
             // Basic JS Sanity Check
             if (!tick.price || tick.price <= 0) {
                 this.metrics.dropped++;
                 return;
             }
        }

        // 2. Deduplication
        // Check if price changed significantly? or checks volume?
        // User asked for "Implement data deduplication".
        const key = tick.symbol;
        const last = this.lastPriceMap.get(key);
        
        // If price, vol, bid, ask are same -> Skip
        if (last && 
            last.price === tick.price && 
            last.volume === tick.volume &&
            last.bid === tick.bid &&
            last.ask === tick.ask
           ) {
            this.metrics.dupes++;
            return;
        }
        
        this.lastPriceMap.set(key, tick);

        // 3. Priority Queueing
        if (this.activeSymbols.has(tick.symbol)) {
            this.buffers.high.push(tick);
        } else {
            this.buffers.normal.push(tick);
        }

        this._scheduleDrain();
    }

    _scheduleDrain() {
        if (!this.isRunning) return;
        if (this._drainScheduled) return;
        this._drainScheduled = true;

        const schedule = global.setImmediate
            ? global.setImmediate
            : (fn) => setTimeout(fn, 0);

        schedule(() => {
            this._drainScheduled = false;
            // Fire-and-forget; errors should not crash the process.
            this._drain().catch(() => {});
        });
    }

    async _drain() {
        if (!this.isRunning) return;
        if (this._draining) return;
        this._draining = true;

        try {
            while (this.isRunning) {
                let processed = 0;
                const BATCH_SIZE = 100; // Process in chunks to yield event loop

                // High Priority First
                while (!this.buffers.high.isEmpty() && processed < BATCH_SIZE) {
                    const tick = this.buffers.high.pop();
                    if (tick) {
                        this.broadcaster(tick);
                        this.metrics.out++;
                        processed++;
                    }
                }

                // Normal Priority (only if we have bandwidth/time)
                if (processed < BATCH_SIZE) {
                    while (!this.buffers.normal.isEmpty() && processed < BATCH_SIZE) {
                        const tick = this.buffers.normal.pop();
                        if (tick) {
                            this.broadcaster(tick);
                            this.metrics.out++;
                            processed++;
                        }
                    }
                }

                if (processed > 0) {
                    if (global.setImmediate) await new Promise((r) => setImmediate(r));
                    else await new Promise((r) => setTimeout(r, 0));
                    continue;
                }

                break; // Nothing to do; go idle until next push()
            }
        } finally {
            this._draining = false;
        }

        if (!this.isRunning) return;
        if (!this.buffers.high.isEmpty() || !this.buffers.normal.isEmpty()) {
            this._scheduleDrain();
        }
    }

    getStats() {
        return this.metrics;
    }
}

export const pipeline = new DataPipeline();
export default pipeline;

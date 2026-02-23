import { connectionPool } from '../utils/connection-pool.js';
import logger from '../config/logger.js';
import allTickService from './alltick.service.js';
import metricsCollector from '../monitoring/metricsCollector.js';

// --- Worker Class ---
class PartitionWorker {
    constructor(id) {
        this.id = id;
        this.symbols = new Set();
        this.ws = null;
        this.reconcileTimer = null;
        this.heartbeatTimer = null;
        this.lastHeartbeatTime = 0;
    }

    startHeartbeat() {
        this.stopHeartbeat();
        logger.info(`[WS-Worker ${this.id}] Starting Heartbeat Loop`);
        
        // Send immediate first beat
        this.sendHeartbeat();

        this.heartbeatTimer = setInterval(() => {
            this.sendHeartbeat();
        }, 10000);
    }

    sendHeartbeat() {
        if (this.ws && this.ws.readyState === 1) {
            logger.info(`[WS-Worker ${this.id}] Sending Heartbeat (22000)`);
            this.lastHeartbeatTime = Date.now();
            this.ws.send(JSON.stringify({
                cmd_id: 22000,
                seq_id: Math.floor(Date.now() / 1000), // Simple Int Timestamp
                trace: 'hb' + Date.now()
            }));
        } else {
            logger.warn(`[WS-Worker ${this.id}] Cannot send Heartbeat - Socket not OPEN`);
        }
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    get count() {
        return this.symbols.size;
    }

    add(symbol) {
        this.symbols.add(symbol);
        this.scheduleReconcile();
    }

    remove(symbol) {
        this.symbols.delete(symbol);
        this.scheduleReconcile();
    }

    scheduleReconcile() {
        if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
        this.reconcileTimer = setTimeout(() => this.reconcile(), 100); // 100ms debounce
    }

    async reconcile() {
        // If empty, we might want to close connection or just stay idle?
        // For now, keep connection but send empty subscribe? 
        // AllTick API: cmd_id 22004 with symbol_list.
        
        if (this.symbols.size === 0) {
            // No symbols, maybe close socket to save resources?
            // connectionPool.removeConnection(this.id); 
            // but for now, let's just do nothing or send empty?
            return; 
        }

        const symbolList = Array.from(this.symbols);
        if (!allTickService.token) {
            logger.warn(`[WS-Worker ${this.id}] Skipping Reconcile - No Token Available`);
            return;
        }
        const tokenPreview = allTickService.token.substring(0, 5) + '...';
        logger.info(`[WS-Worker ${this.id}] Reconcile: ${symbolList.length} symbols. Token: ${tokenPreview}`);
        logger.info(`[WS-Worker ${this.id}] Symbols: ${JSON.stringify(symbolList)}`);
        const url = `${allTickService.wsUrl}?token=${allTickService.token}`;
        
        try {
            // Get Connection from Pool
            this.ws = await connectionPool.getConnection(this.id, {
                url,
                maxRetries: 100,
                baseBackoff: 2000,
                maxBackoff: 60000,
                heartbeatInterval: 0 // DISABLE NATIVE HEARTBEAT (Conflict with App Level HB)
            });
            
            // Send Subscribe Command
            // Need to map symbols if Aliases used? 
            // Assuming Manager passes valid ALLTICK codes or we map here.
            // Let's assume Manager handles mapping or we ask AllTickService.
            const codes = symbolList.map(s => allTickService.aliasMap[s] || s);

            const payload = {
                cmd_id: 22002, // MSPK: Subscribe to DEPTH (Level 2) for Bid/Ask
                seq_id: Math.floor(Date.now() / 1000),
                trace: 'sub' + Date.now(),
                data: { 
                    symbol_list: codes.map(c => ({ code: c, depth_level: 5 })) 
                }
            };
            
            if (this.ws.readyState === 1) { // OPEN
                this.ws.send(JSON.stringify(payload));
                // logger.debug(`[WS-Worker ${this.id}] Subscribed to ${codes.length} symbols`);
            } else {
                // If not open, Pool will handle reconnect and 'open' event?
                // We should listen to 'open' to resubscribe.
                // NOTE: ConnectionPool emits events globally.
            }
        } catch (e) {
            logger.error(`[WS-Worker ${this.id}] Reconcile Failed: ${e.message}`);
        }
    }
}

// --- Manager Class ---
class WebSocketManager {
    constructor() {
        this.MAX_SYMBOLS_PER_WORKER = 200; // AllTick allows hundreds per connection
        this.viewportInterest = new Map(); // Symbol -> Expiry Time
        this.workers = new Map(); // ID -> PartitionWorker
        this.symbolToWorker = new Map(); // Symbol -> WorkerID
        this.messageBuffer = new Map(); // Symbol -> Latest Tick
        this.bufferTimer = null;
        this.marketDataService = null;

        // Cleanup Interval (60s)
        setInterval(() => this.cleanupViewport(), 60000);
        
        // Listen to Pool Messages globally to route them
        // This is efficient? Or should Workers listen to their specific ID?
        // Pool emits `message:${id}`. Workers should handle their own message parsing?
        // Or Manager handles all and routes?
        // Let's have Manager handle all for Batching Centralization.
    }

    init(marketDataService) {
        this.marketDataService = marketDataService;
        
        // Start Buffer Flush Loop
        this.bufferTimer = setInterval(() => this.flushBuffer(), 500); 
    }

    /**
     * Update what the User is verifying looking at
     * @param {string[]} symbols 
     */
    updateViewport(symbols) {
        const now = Date.now();
        // Update Interest
        symbols.forEach(s => {
            if (!s) return;
            if (s.includes(':')) return; // Safety: Reject NSE/MCX symbols
            this.viewportInterest.set(s, now + 60000); // 60s TTL
        });

        this.rebalance();
    }

    cleanupViewport() {
        const now = Date.now();
        let changed = false;
        
        for (const [sym, expiry] of this.viewportInterest) {
            // Keep "Essentials" always?
            // Assuming Essentials are handled by checking `marketDataService` or hardcoded?
            // For now, if expired, remove.
            if (now > expiry) {
                this.viewportInterest.delete(sym);
                changed = true;
            }
        }

        if (changed) this.rebalance();
    }

    rebalance() {
        // Current Desired Set
        const desiredTypes = new Set(this.viewportInterest.keys());
        
        // Add Essentials (Hardcoded for now or from Config)
        const essentials = ['BTCUSD', 'ETHUSD', 'XAUUSD', 'EURUSD'];
        essentials.forEach(s => desiredTypes.add(s));

        // Sync with Actual Workers
        const currentActive = new Set(this.symbolToWorker.keys());
        
        // Reporting
        metricsCollector.updateWsConnections(this.workers.size);

        // 1. Remove Unwanted
        for (const sym of currentActive) {
            if (!desiredTypes.has(sym)) {
                this._removeSymbol(sym);
            }
        }

        // 2. Add New
        for (const sym of desiredTypes) {
            if (!currentActive.has(sym)) {
                this._addSymbol(sym);
            }
        }
    }

    _addSymbol(symbol) {
        // Find suitable worker
        let worker = null;
        for (const w of this.workers.values()) {
            if (w.count < this.MAX_SYMBOLS_PER_WORKER) {
                worker = w;
                break;
            }
        }

        // Create new if needed
        if (!worker) {
            // Partitioning: Create new worker with incremental ID
            const id = `alltick_${this.workers.size}`; 
            worker = new PartitionWorker(id);
            this.workers.set(id, worker);
            this._setupWorkerListener(id);
        }

        worker.add(symbol);
        this.symbolToWorker.set(symbol, worker.id);
    }

    _removeSymbol(symbol) {
        const wid = this.symbolToWorker.get(symbol);
        if (wid) {
            const worker = this.workers.get(wid);
            if (worker) worker.remove(symbol);
            this.symbolToWorker.delete(symbol);
        }
    }

    _setupWorkerListener(id) {
        // Bind to Pool Events
        connectionPool.on(`message:${id}`, (data) => {
            this._handleWorkerMessage(id, data);
        });
        
        
        // On Open, trigger reconcile for that worker (Resubscribe)
        connectionPool.on(`open:${id}`, () => {
             logger.info(`[WS-Manager] Link Open Event received for ${id}`);
             const worker = this.workers.get(id);
             if (worker) {
                 worker.reconcile();
                 worker.startHeartbeat();
                 this._updateGlobalStatus();
             }
        });

        connectionPool.on(`close:${id}`, () => {
            const worker = this.workers.get(id);
            if (worker) {
                worker.stopHeartbeat();
                this._updateGlobalStatus();
            }
        });
    }

    _updateGlobalStatus() {
        let anyConnected = false;
        for (const worker of this.workers.values()) {
            if (worker.ws && worker.ws.readyState === 1) {
                anyConnected = true;
                break;
            }
        }
        allTickService.isConnected = anyConnected;
    }

    _handleWorkerMessage(id, data) {
        try {
            const message = JSON.parse(data.toString());
            const worker = this.workers.get(id);

            // Handle Heartbeat Response (cmd_id 22000/22001)
            if (message.cmd_id === 22000 || message.cmd_id === 22001 || (message.trace && message.trace.startsWith('hb-'))) {
                logger.info(`[WS-Manager] Received Heartbeat ACK from ${id}`);
                if (worker && worker.lastHeartbeatTime) {
                    const rtt = Date.now() - worker.lastHeartbeatTime;
                    allTickService.latency = rtt > 0 ? rtt : 1;
                    allTickService.isConnected = true; // Confirmation
                }
                return;
            }
            
             if (message.cmd_id === 22998 && message.data) { // Tick
                 this._bufferTick(message.data);
             } else if (message.cmd_id === 22999 && message.data) { // Depth
                 this._bufferDepth(message.data);
             } else {
                 // Spy on unknown messages to debug "Silence"
                 logger.info(`[WS-Worker ${id}] Received Non-Tick Message: ${JSON.stringify(message).substring(0, 200)}`);
             }
        } catch (e) {
            // ignore JSON Error
        }
    }

    _bufferTick(tick) {
        const symbol = tick.code; // Need to map alias back?
        // Using raw code for buffer, map later
        
        this.messageBuffer.set(symbol, {
            symbol: symbol,
            last_price: parseFloat(tick.price),
            timestamp: new Date(parseInt(tick.tick_time || Date.now())),
            ohlc: {
                open: parseFloat(tick.open),
                high: parseFloat(tick.high),
                low: parseFloat(tick.low),
                close: parseFloat(tick.price)
            },
            volume: parseFloat(tick.volume),
            // Capture Bid/Ask if present in Tick (rare but possible)
            bid: parseFloat(tick.bid || 0),
            ask: parseFloat(tick.ask || 0)
        });
    }

    _bufferDepth(tick) {
        const symbol = tick.code;
        const bid = parseFloat(tick.bids?.[0]?.price || 0);
        const ask = parseFloat(tick.asks?.[0]?.price || 0);
        const price = parseFloat(tick.price || bid || ask || 0); // Use Tick Price if available in Depth, else mid

        if (price === 0) return;

        this.messageBuffer.set(symbol, {
            symbol: symbol,
            last_price: price,
            timestamp: new Date(parseInt(tick.tick_time || Date.now())),
            ohlc: { open: price, high: price, low: price, close: price },
            volume: 0,
            // CRITICAL: Pass Depth Data
            bid: bid,
            ask: ask
        });
    }

    flushBuffer() {
        if (this.messageBuffer.size === 0 || !this.marketDataService) return;

        const ticks = Array.from(this.messageBuffer.values()).map(t => {
            // Alias Mapping Back
            // Inverse lookup aliasMap? or just use what we have
            const realSym = Object.keys(allTickService.aliasMap).find(key => allTickService.aliasMap[key] === t.symbol) || t.symbol;
            return { ...t, symbol: realSym };
        });

        // Clear Buffer
        this.messageBuffer.clear();

        // Send to MarketData
        if (ticks.length > 0) {
            logger.info(`[WS-Manager] Flushing ${ticks.length} ticks to MarketDataService`);
            this.marketDataService.processLiveTicks(ticks, 'alltick');
            metricsCollector.trackWsMessage(); // Count batches or ticks? Let's count batches. 
            // Or maybe count raw ticks? "Messages/Second" usually means frames. 
            // Since we send 1 frame to Frontend via socket.js (which we track later?), 
            // here we track internal throughput.
        }
    }
}

export default new WebSocketManager();

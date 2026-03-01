import WebSocket from 'ws';
import axios from 'axios';
import EventEmitter from 'events';
import logger from '../config/log.js';
import { ALLTICK_POPULAR_SYMBOLS } from '../data/alltick_popular.js';
import requestQueue from '../utils/requestQueue.js';
import cacheManager from './cacheManager.js';

class AllTickService extends EventEmitter {
    constructor() {
        super();
        this.token = null;
        this.ws = null;
        this.baseUrl = 'https://quote.alltick.co/quote-b-api';
        this.wsUrl = 'wss://quote.alltick.co/quote-b-ws-api';
        this.symbols = [];
        this.isConnected = false;
        this.heartbeatInterval = null;
        this.seqId = 1;
        this.latency = 0;
        this.lastHeartbeatTime = 0;
        this.isRateLimited = false;
        this.reconnectTimeout = null;
        
        // Alias Map for symbols that differ between DB and AllTick
        this.aliasMap = {
            'WTICOUSD': 'USOIL',
            'XAUUSD': 'GOLD', 
            'XAGUSD': 'SILVER',
            'BTCUSD': 'BTCUSDT',
            'ETHUSD': 'ETHUSDT'
        };
    }

    initialize(token) {
        this.token = token;
    }

    async connectTicker(onTicks, onConnect) {
        if (!this.token) {
            logger.error('AllTick: Cannot connect without token');
            return;
        }

        const CONNECTION_ID = 'alltick_feed';
        const url = `${this.wsUrl}?token=${this.token}`;

        try {
            const { connectionPool } = await import('../utils/connection-pool.js');
            
            // Listen to Pool Events for this connection
            // Remove previous listeners to avoid duplicates if this method is called again
            connectionPool.removeAllListeners(`message:${CONNECTION_ID}`);
            connectionPool.removeAllListeners(`open:${CONNECTION_ID}`);
            connectionPool.removeAllListeners(`close:${CONNECTION_ID}`);

            // Message Handler
            connectionPool.on(`message:${CONNECTION_ID}`, (data) => {
                this._handleMessage(data, onTicks);
            });

            // Open Handler
            connectionPool.on(`open:${CONNECTION_ID}`, () => {
                this.isConnected = true;
                this.isRateLimited = false;
                // No need to manually start heartbeat, Pool does it
                if (onConnect) onConnect();
            });

            // Close/Error Handler
            connectionPool.on(`close:${CONNECTION_ID}`, () => {
                this.isConnected = false;
            });
            
            // Listen for General Pool Errors if emitted
            connectionPool.on(`error:${CONNECTION_ID}`, (err) => {
                 logger.error(`[AllTick-Pool] Connection Error: ${err.message || err}`);
                 this.isConnected = false;
            });
            
            // Get Managed Connection
            this.ws = await connectionPool.getConnection(CONNECTION_ID, {
                url,
                maxRetries: 100, // Infinite-ish
                baseBackoff: 2000,
                maxBackoff: 60000,
                heartbeatInterval: 20000
            });

        } catch (e) {
            logger.error(`AllTick Connection Failed: ${e.message}`);
        }
    }

    _handleMessage(data, onTicks) {
        try {
            const message = JSON.parse(data.toString());
            
            // Pool handles Heartbeats (Ping/Pong frames or internal logic), 
            // BUT AllTick protocol has its own Application Level Heartbeat (Cmd 22000).
            // We should still respond to that if needed, or initiate it.
            // Pool does network ping/pong. Application HB needs to pass through.
            
            // Application Heartbeat Response
            if (message.cmd_id === 22000 || message.cmd_id === 22001 || message.trace?.startsWith('hb-')) {
                // If we need to compute application latency:
                if (this.lastHeartbeatTime) {
                     const rtt = Date.now() - this.lastHeartbeatTime;
                     this.latency = rtt > 0 ? rtt : 1; 
                }
                return;
            }

            // Handle Tick Data (Cmd 22998)
            if (message.cmd_id === 22998 && message.data) {
                 const tick = message.data;
                 // Map back to original symbol if aliased
                 const displaySymbol = Object.keys(this.aliasMap).find(key => this.aliasMap[key] === tick.code) || tick.code;

                 const normalizedTicks = [{
                     symbol: displaySymbol,
                     last_price: parseFloat(tick.price || 0),
                     volume: parseFloat(tick.volume || 0),
                     timestamp: new Date(parseInt(tick.tick_time || Date.now())),
                     bid: parseFloat(tick.bp1 || 0),
                     ask: parseFloat(tick.ap1 || 0),
                     ohlc: {
                         open: parseFloat(tick.open || 0),
                         high: parseFloat(tick.high || 0),
                         low: parseFloat(tick.low || 0),
                         close: parseFloat(tick.price || 0)
                     }
                 }];
                 onTicks(normalizedTicks);
            }
            
            // Handle Market Depth (Cmd 22999) - PRIMARY SOURCE for many symbols
            else if (message.cmd_id === 22999 && message.data) {
                const tick = message.data;
                const displaySymbol = Object.keys(this.aliasMap).find(key => this.aliasMap[key] === tick.code) || tick.code;
                
                const bestBid = parseFloat(tick.bids?.[0]?.price || 0);
                const bestAsk = parseFloat(tick.asks?.[0]?.price || 0);
                const derivedPrice = bestBid > 0 ? bestBid : bestAsk;

                const normalizedTicks = [{
                    symbol: displaySymbol,
                    last_price: derivedPrice, 
                    volume: 0, 
                    timestamp: new Date(parseInt(tick.tick_time || Date.now())),
                    bid: bestBid,
                    ask: bestAsk,
                    ohlc: {
                        open: derivedPrice,
                        high: derivedPrice,
                        low: derivedPrice,
                        close: derivedPrice
                    }
                }];

                if (bestBid > 0 || bestAsk > 0) {
                    onTicks(normalizedTicks);
                }
            }
            
            else if (message.error || message.msg === 'error' || (message.status && message.status !== 0)) {
                if (message.msg === 'success') return;
                logger.error(`AllTick Error: ${JSON.stringify(message)}`);
            }

        } catch (error) {
            logger.error('AllTick: Error parsing message', error);
        }
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && (this.isConnected || this.ws.readyState === 1)) {
                this.lastHeartbeatTime = Date.now();
                this.ws.send(JSON.stringify({
                    cmd_id: 22000,
                    seq_id: this.seqId++,
                    trace: `hb-${Date.now()}`,
                    data: {}
                }));
            }
        }, 10000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    subscribe(symbolList) {
        if (!this.ws || !this.isConnected) return;
        
        // Map symbols to AllTick codes using aliasMap
        const codes = symbolList.map(s => this.aliasMap[s] || s);
        this.symbols = symbolList;

        const quotePayload = {
            cmd_id: 22004,
            seq_id: this.seqId++,
            trace: `sub-quote-${Date.now()}`,
            data: {
                symbol_list: codes.map(c => ({ code: c }))
            }
        };
        this.ws.send(JSON.stringify(quotePayload));

        setTimeout(() => {
            if (!this.ws || !this.isConnected) return;
            const depthPayload = {
                cmd_id: 22002,
                seq_id: this.seqId++,
                trace: `sub-depth-${Date.now()}`,
                data: {
                    symbol_list: codes.map(c => ({ code: c, depth_level: 5 }))
                }
            };
            this.ws.send(JSON.stringify(depthPayload));
        }, 1500); 
    }

    async getQuote(symbols) {
        if (!this.token) {
            logger.warn('AllTick: Token missing, skipping quote');
            return {};
        }
        if (!symbols || symbols.length === 0) return {};
        
        // Key based on symbols sorted
        const sortedSyms = [...symbols].sort().join(',');
        const requestKey = `quote_${sortedSyms}`;
        
        return requestQueue.add(requestKey, async () => {
            const results = {};
            // Chunking is now handled by caller or we rely on Queue to serialise?
            // Existing logic does chunks inside loop.
            // Queue expects a single unit of work.
            // We should keep the logic simpler here or iterate.
            
            for (const sym of symbols) {
                try {
                    const code = this.aliasMap[sym] || sym;
                    const to = Date.now();
                    const from = to - (24 * 60 * 60 * 1000); 
                    
                    // Recursive call to getHistoricalData? 
                    // No, getHistoricalData is also queued. Nested queue might deadlock if single concurrency?
                    // Queue supports priority.
                    // But if getQuote is one task, and it waits for getHistory which is another task...
                    // Safe if concurrency > 1 or re-entrant?
                    // RequestQueue doesn't support re-entrancy deadlock prevention natively if limit is 1.
                    // But limit is 50/min, parallel processing is 1 at a time?
                    // "process" loop awaits task().
                    // If task() awaits queue.add(), and queue is full/busy processing task(), we deadlock?
                    // Wait, process() runs tasks sequentially?
                    // "await job.task()" -> Yes.
                    // DEADLOCK RISK if getQuote calls getHistoricalData via Queue.
                    
                    // FIX: Direct call or priority management?
                    // Better: getQuote should call internal _fetchHistoryWithoutQueue or we just queue the whole block as one?
                    // Actually existing getQuote calls getHistoricalData.
                    // If I wrap getQuote in Queue, and getHistory in Queue...
                    // The "Quote Task" starts. It calls "History Task". "History Task" is added to queue.
                    // "Quote Task" awaits "History Task".
                    // Queue processor is blocked waiting for "Quote Task"; it cannot pick up "History Task".
                    // DEADLOCK.
                    
                    // SOLUTION: Do NOT queue `getQuote` if it just delegates.
                    // OR: `getQuote` should just call `getHistoricalData` (which IS queued).
                    // Rate limiting happens at the leaf node (Actual API call).
                    
                    // So, I will ONLY wrap the actual API calls or the leaf method.
                    // getHistoricalData does the API call.
                    // So getQuote calls getHistoricalData, which queues itself.
                    // This is fine. getQuote itself doesn't need to be queued, just its components.
                    // But we want to deduplicate "getQuote(A,B)"?
                    // Deduplication of getHistoricalData(A) happens anyway.
                    
                    const candles = await this.getHistoricalData(sym, '1h', new Date(from), new Date(to));
                    
                    if (candles.length > 0) {
                        const last = candles[candles.length - 1];
                        results[sym] = {
                            last_price: last.close,
                            ohlc: { open: last.open, high: last.high, low: last.low, close: last.close },
                            timestamp: last.time
                        };
                    }
                    // No throttling needed here, Queue handles it!
                } catch (e) {
                    logger.warn(`AllTick Quote Failed for ${sym}: ${e.message}`);
                }
            }
            return results;
        }, 1); // Prio 1
    }
    
    // WAIT, if I wrap getQuote, I hit deadlock as analyzed.
    // getQuote logic mainly loops and calls getHistoricalData.
    // If I DO NOT wrap getQuote, but wrap getHistoricalData, rate limit is enforced.
    // Efficiency: getQuote(A,B) -> getHist(A) + getHist(B). 
    // Both queued. Limit enforced. Perfect.
    // So I will NOT wrap `getQuote` implementation, just let it use the Queued `getHistoricalData`.
    // I only need to modify `getHistoricalData`.
    
    // BUT wait, `getQuote` has a "throttle" `setTimeout(200)` inside it (line 265).
    // I should REMOVE that manual throttle since Queue covers it.

    async getQuote(symbols) {
        const results = {};
        for (const sym of symbols) {
             try {
                 const code = this.aliasMap[sym] || sym;
                 const to = Date.now();
                 const from = to - (24 * 60 * 60 * 1000); 
                 
                 // Priority 1 for Quote Data (User waiting?)
                 // getHistoricalData defaults to Prio 2. 
                 // We might need to pass priority?
                 // Let's add priority arg to getHistoricalData or just use Prio 2.
                 // Quotes are usually startup/background. Prio 2 is fine.
                 
                 const candles = await this.getHistoricalData(sym, '1h', new Date(from), new Date(to), 2); // Priority 2 for Quotes
                 
                 if (candles.length > 0) {
                     const last = candles[candles.length - 1];
                     results[sym] = {
                         last_price: last.close,
                         ohlc: { open: last.open, high: last.high, low: last.low, close: last.close },
                         timestamp: last.time
                     };
                 }
             } catch (e) {
                 logger.warn(`AllTick Quote Failed for ${sym}: ${e.message}`);
             }
        }
        return results;
    }

    async getHistoricalData(symbol, interval, from, to, priority = 2) {
        if (!this.token) {
            logger.warn(`AllTick: Token missing, skipping history for ${symbol}`);
            return [];
        }
        const code = this.aliasMap[symbol] || symbol;
        const fromTs = Math.floor(new Date(from).getTime() / 1000);
        const toTs = to ? Math.floor(new Date(to).getTime() / 1000) : 0;
        
        const requestKey = `${code}_${interval}_${fromTs}_${toTs}`;
        
        // Use 3-Tier Cache Manager (L1->L2->L3)
        return cacheManager.getOrFetch(
            requestKey,
            async () => {
                // Fetch via Queue
                return requestQueue.add(requestKey, async () => {
                    return this._fetchHistoricalDataInternal(symbol, code, interval, from, to);
                }, priority);
            },
            '24h' // TTL for Historical Data (Disk Worthy)
        );
    }

    // Extracted internal method for the actual fetch logic
    async _fetchHistoricalDataInternal(symbol, code, interval, from, to) {
        try {
            const klineMap = {
                '1': 1, '1m': 1, 'minute': 1,
                '3': 1, '5': 2, '5m': 2, '15': 3, '15m': 3,
                '30': 4, '30m': 4, '60': 5, '1h': 5, '1H': 5,
                'D': 8, '1D': 8, 'day': 8, 'W': 9, '1W': 9, 'M': 10, '1M': 10
            };

            let allCandles = [];
            let currentEnd = to ? Math.floor(new Date(to).getTime() / 1000) : 0;
            const stopTime = Math.floor(new Date(from).getTime() / 1000);
            let page = 0;

            while (page < 5) { // Limit pages
                const queryObj = {
                    data: {
                        code: code,
                        kline_type: klineMap[interval] || 1,
                        kline_timestamp_end: currentEnd, 
                        query_kline_num: 500,
                        adjust_type: 0
                    }
                };
    
            const url = `${this.baseUrl}/kline?token=${this.token}`;
            logger.debug(`[AllTick-History] Fetching: ${code} (${interval}). URL: ${url}`);

            const response = await axios.get(url, { 
                params: { query: JSON.stringify(queryObj) },
                timeout: 5000 // 5s Strict Timeout
            });
            
            if (response?.data) {
                 logger.debug(`[AllTick-History] Response for ${code}: Ret=${response.data.ret} Msg=${response.data.msg} Count=${response.data.data?.kline_list?.length || 0}`);
            }
    
                if (response?.data?.data?.kline_list) {
                    const list = response.data.data.kline_list;
                    if (list.length === 0) break;

                    const mapped = list.map(k => ({
                        time: parseFloat(k.timestamp) > 10000000000 ? parseFloat(k.timestamp) / 1000 : parseFloat(k.timestamp),
                        open: parseFloat(k.open_price),
                        high: parseFloat(k.high_price),
                        low: parseFloat(k.low_price),
                        close: parseFloat(k.close_price),
                        volume: parseFloat(k.volume)
                    }));

                    allCandles = [...allCandles, ...mapped];
                    const firstTime = mapped[0].time;
                    if (firstTime <= stopTime) break;
                    currentEnd = firstTime; 
                    page++;
                    // Internal pagination delay? Queue doesn't know about pages.
                    // If we loop 5 times rapidly, we hog 5 seconds or 5 slots?
                    // Ideally each page is a request.
                    // But here we treat "Get History" as one atomic multi-page op?
                    // If we do 5 axios calls in one "Task", and we occupy the slot...
                    // The Queue waits for Task completion.
                    // So we are "Processing" for X seconds.
                    // That's fine, but we might hit rate limit if we burst 5 calls inside.
                    // The Queue Rate Limiter only limits *Entry* of tasks.
                    // It does NOT limit axios calls made *inside* a task.
                    // CRITICAL: We need to respect rate limit INSIDE the loop too if it makes multiple calls.
                    // Or we break pagination into recursive tasks?
                    // Simpler: Just add a delay between pages manually here.
                    await new Promise(r => setTimeout(r, 1200)); // Respect the 1.2s rule internally
                } else break;
            }
            
            const validCandles = allCandles.filter(c => c.time > 0 && c.close > 0);
            return Array.from(new Map(validCandles.map(item => [item.time, item])).values()).sort((a, b) => a.time - b.time);
            
        } catch (error) {
            // Propagate 429 for Queue to handle
            throw error;
            // Logger inside Queue handles it? 
            // Queue catches error. If 429 -> Retry.
            // If other error -> Reject.
            // We should catch non-429 here to log context?
            // Queue logs 429.
        }
    }

    async search(query) {
        if (!query || query.trim().length === 0) return [];
        const q = query.toUpperCase();
        const localMatches = ALLTICK_POPULAR_SYMBOLS.filter(s => 
            s.symbol.includes(q) || s.name.toUpperCase().includes(q)
        ).map(s => ({ ...s, tickSize: 0.01, lotSize: 1 }));
        
        if (!this.token) {
            logger.warn('AllTick: Token missing, skipping live search');
            return localMatches;
        }

        try {
            // Queue Search Requests (Priority 3 - Low)
            const requestKey = `search_${q}`;
            return requestQueue.add(requestKey, async () => {
                 const queryObj = { data: { symbol: query } };
                 const url = `${this.baseUrl}/search?token=${this.token}&query=${encodeURIComponent(JSON.stringify(queryObj))}`;
                 const response = await axios.get(url, { timeout: 2000 });
    
                 let results = [...localMatches];
                 if (response.data?.data?.symbol_list) {
                     const apiResults = response.data.data.symbol_list.map(s => ({
                         symbol: s.symbol,
                         name: s.name_en || s.name,
                         exchange: s.exchange_code,
                         segment: this.mapSegment(s.exchange_code),
                         tickSize: 0.01,
                         lotSize: 1
                     }));
                     const existing = new Set(results.map(r => r.symbol));
                     apiResults.forEach(r => { if (!existing.has(r.symbol)) results.push(r); });
                 }
                 return results;
            }, 3);

        } catch (error) {
            return localMatches;
        }
    }

    mapSegment(exchange) {
        const ex = exchange.toUpperCase();
        if (ex === 'FOREX' || ex === 'FX') return 'CURRENCY';
        if (ex === 'CRYPTO' || ex === 'BINANCE') return 'CRYPTO';
        return 'EQUITY';
    }
}

export const allTickService = new AllTickService();
export default allTickService;

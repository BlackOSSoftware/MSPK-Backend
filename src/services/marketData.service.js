import requestQueue from '../utils/requestQueue.js'; // Move to top
import EventEmitter from 'events'; // Restart Trigger
import Setting from '../models/Setting.js';
import MasterSymbol from '../models/MasterSymbol.js';
import { kiteService } from './kite.service.js';
import { kiteInstrumentsService } from './kiteInstruments.service.js';
import { allTickService } from './alltick.service.js';
import { economicService } from './economic.service.js';
import pipeline from '../utils/pipeline/DataPipeline.js'; // Pipeline Optimization
import { redisClient } from './redis.service.js';
import logger from '../config/logger.js';
import { decrypt, encrypt } from '../utils/encryption.js';
import websocketManager from './websocketManager.js';
import startupOptimizer from './startupOptimizer.js';
import cacheManager from './cacheManager.js';

console.log('DEBUG: MarketDataService loaded. RequestQueue:', requestQueue);

class MarketDataService extends EventEmitter {
    constructor() {
        super();
        this.mode = 'idle'; // 'idle' | 'live'
        this.symbols = {}; 
        this.tokenMap = {}; // instrument_token -> symbol
        this.currentPrices = {};
        this.cumulativeVolume = {}; // Track daily volume for AllTick
        this.kiteTickCount = 0;
        this.kiteLatency = 0; // Real-time latency tracking
        this.allTickTickCount = 0;
        this.startTime = new Date();
        this.config = {}; // Prevent startup crash
    }

// ... (skipping for brevity)
    async initializeKiteInstruments() {
        try {
            await kiteInstrumentsService.loadIntoMemory();
        } catch (error) {
            logger.error('Failed to initialize Kite instruments in MarketDataService');
        }
    }

    async init() {
        logger.info('MARKET_DATA: Initializing Service...');
        try {
            await this.initializeKiteInstruments();
            await this.loadMasterSymbols(); // Load symbols FIRST
            await this.loadSettings();      // Then load settings (which starts feed)
            
            // Redundant startLiveFeed removed to prevent double-initialization crash

            this.startStatsBroadcast();
        } catch (error) {
            logger.error('MARKET_DATA_ERROR: Failed to initialize', error);
        }
    }

    startStatsBroadcast() {
        if (this.statsInterval) clearInterval(this.statsInterval);
        
        this.statsInterval = setInterval(() => {
            const stats = this.getStats();
            // Emit to local event bus (e.g. for socket service to pick up)
            this.emit('stats_update', stats);
        }, 1000);
    }

    async loadMasterSymbols() {
        try {
            const symbols = await MasterSymbol.find({});
            this.symbols = {};
            this.tokenMap = {};
            
            symbols.forEach(s => {
                this.symbols[s.symbol] = s;
                if (s.instrumentToken) {
                    this.tokenMap[s.instrumentToken] = s.symbol;
                }
            });
            logger.info(`MARKET_DATA: Loaded ${symbols.length} master symbols into memory`);
        } catch (error) {
            logger.error('Error loading master symbols:', error);
        }
    }

    /**
     * Dynamically add a symbol to memory and subscribe
     */
    async addSymbol(symbolDoc) {
        if (!symbolDoc || !symbolDoc.symbol) return;

        logger.info(`MARKET_DATA: Adding new symbol ${symbolDoc.symbol} to memory`);
        this.symbols[symbolDoc.symbol] = symbolDoc;
        
        if (symbolDoc.instrumentToken) {
            this.tokenMap[symbolDoc.instrumentToken] = symbolDoc.symbol;
            if (this.adapter && this.adapter.isTickerConnected) {
                this.adapter.subscribe([symbolDoc.instrumentToken]);
                // Fetch initial snapshot for this symbol (crucial for closed markets)
                this.fetchInitialQuote([symbolDoc.instrumentToken]);
            }
        } else {
            // Handle AllTick / Global Symbols
            const indianExchanges = ['NSE', 'BSE', 'MCX', 'NFO', 'CDS', 'BCD'];

            if (!indianExchanges.includes(symbolDoc.exchange) && (allTickService.isConnected || this.config.alltick_api_key)) {
                // Fetch initial data immediately
                allTickService.getQuote([symbolDoc.symbol]).then(quotes => {
                    this._processQuotes(quotes);
                });
                
                // We rely on WebSocketManager's dynamic viewport update from frontend
                // to trigger the permanent subscription for this new symbol.
            }
        }
    }

    subscribeToSymbols() {
        if (Object.keys(this.symbols).length === 0) {
            logger.warn('MARKET_DATA: No symbols loaded to subscribe');
            return;
        }

        const allSymbols = Object.keys(this.symbols);

        // 1. Kite Subscription
        if (this.adapter && this.adapter.isTickerConnected) {
            const tokens = allSymbols
                .map(s => this.symbols[s].instrumentToken)
                .filter(t => t); // Filter only those with tokens
            
            logger.info(`[DEBUG_SUB] Found ${allSymbols.length} total symbols. ${tokens.length} have Kite tokens.`);

            if (tokens.length > 0) {
                 this.adapter.subscribe(tokens);
                 logger.info(`[DEBUG_SUB] Subscribing to Kite Tokens: ${tokens.join(',')}`);
                 
                 // Fetch initial static Data (for closed markets like NSE Equity at night)
                 this.fetchInitialQuote(tokens);
            } else {
                logger.warn('[DEBUG_SUB] No user symbols found, but Indices should be auto-subscribed?');
            }
            
            // Force Subscribe to Critical Indices (If not in master list already)
            // Ideally these should be in MasterSymbols, but safekeep here:
            // "NSE:INDIA VIX" isn't standard in all instrument lists, check instrument service.
            
            const coreINDICES = ['NSE:NIFTY 50-INDEX', 'NSE:NIFTY BANK-INDEX', 'NSE:INDIA VIX'];
            coreINDICES.forEach(sym => {
                const instrument = kiteInstrumentsService.getInstrumentBySymbol(sym);
                if (instrument) {
                    const token = parseInt(instrument.instrument_token);
                    this.adapter.subscribe([token]);
                    this.tokenMap[token] = sym;
                    logger.info(`[DEBUG_SUB] Force subscribed to Index: ${sym} (Token: ${token})`);
                }
            });
        } else {
            logger.warn('[DEBUG_SUB] Adapter not connected or missing');
        }

        // 2. AllTick Subscription (via WebSocket Manager)
        if (allTickService.isConnected || this.config.alltick_api_key) { 
             const symbolsToSubscribe = allSymbols.filter(s => {
                 const sym = this.symbols[s];
                 const indianExchanges = ['NSE', 'BSE', 'MCX', 'NFO', 'CDS', 'BCD'];
                 if (s.includes(':')) return false; // Safety: Any colon usually implies "EXCHANGE:SYMBOL" which AllTick doesn't use (except maybe crypto pairs like BTC:USD but usually they are BTCUSD)
                 return !indianExchanges.includes(sym.exchange) && !sym.instrumentToken;
             });

             const sentimentSymbols = ['BTCUSD', 'ETHUSD', 'XAUUSD', 'EURUSD'];
             const combinedSubs = [...new Set([...symbolsToSubscribe, ...sentimentSymbols])];

             if (combinedSubs.length > 0) {
                 logger.info(`[MarketData] Delegating ${combinedSubs.length} symbols to WebSocketManager`);
                 
                 // Dynamic Viewport Update
                 websocketManager.updateViewport(combinedSubs);
                 
                 // Initial Quote Fetch (Still useful for 0-latency start)
                 allTickService.getQuote(combinedSubs).then(quotes => {
                     this._processQuotes(quotes);
                 });
             }
        }
        
        // --- PHASE 4: Smart Startup Sequence (History) ---
        startupOptimizer.start(this);
    }

    


    // Helper to process quotes and update state
    _processQuotes(quotes) {
        const pseudoTicks = [];
        Object.keys(quotes).forEach(sym => {
            const q = quotes[sym];
            this.currentPrices[sym] = q.last_price;
            if (!this.currentQuotes) this.currentQuotes = {};
            this.currentQuotes[sym] = {
                last_price: q.last_price,
                ohlc: q.ohlc,
                bid: 0, ask: 0, volume: 0, // Vol updated separately
                ...this.currentQuotes[sym] // Keep existing vol if any
            };

            pseudoTicks.push({
                symbol: sym,
                last_price: q.last_price,
                ohlc: q.ohlc,
                total_volume: this.cumulativeVolume[sym] || 0,
                provider: 'alltick'
            });
        });
        
        if (pseudoTicks.length > 0) {
            this._broadcastPseudoTicks(pseudoTicks);
        }
    }

    _updateVolumeFromCandles(sym, candles) {
        if (candles && candles.length > 0) {
             const lastCandle = candles[candles.length - 1];
             this.cumulativeVolume[sym] = lastCandle.volume;
             if (this.currentQuotes[sym]) {
                 this.currentQuotes[sym].volume = lastCandle.volume;
             }
             // Re-broadcast? Maybe not spam. UI updates on next tick.
        }
    }
    
    _broadcastPseudoTicks(ticks) {
        ticks.forEach(t => {
            this.emit('price_update', {
                ...t,
                open: t.ohlc.open, high: t.ohlc.high, low: t.ohlc.low,
                change: 0, changePercent: 0, volume: 0, bid: 0, ask: 0,
                timestamp: new Date()
            });
        });
    }

    async fetchInitialQuote(tokens) {
        try {
            const symbolsToFetch = [];
            // We don't need tokenToSymbolMap here because processLiveTicks uses Token -> Internal Symbol map

            tokens.forEach(t => {
                // Use Kite Instruments Service to get the actual "EXCHANGE:TRADINGSYMBOL" 
                // that Kite API expects (e.g. "NSE:TCS" instead of "NSE:TCS-EQ")
                const correctKiteSymbol = kiteInstrumentsService.getSymbolByToken(t);
                if (correctKiteSymbol) {
                    symbolsToFetch.push(correctKiteSymbol);
                } else {
                    // Fallback to internal map if not found in cache (unlikely if token exists)
                    const symStr = this.tokenMap[t];
                    if (symStr) symbolsToFetch.push(symStr);
                }
            });
            if (symbolsToFetch.length === 0) return;

            logger.info(`Fetching Initial QUOTE for ${symbolsToFetch.length} symbols...`);
            
            // Use getQuote instead of getLTP to get OHLC
            const startFetch = Date.now();
            const quoteData = await this.adapter.getQuote(symbolsToFetch);
            
            // Set initial latency based on REST API RTT
            this.kiteLatency = Date.now() - startFetch;
            logger.info(`[DEBUG_QUOTE] Fetch took ${this.kiteLatency}ms. Wrapper Response keys: ${Object.keys(quoteData).join(',')}`);
            
            // Response: { "NSE:TCS": { instrument_token, last_price, ohlc: {...} } }
            const pseudoTicks = [];
            
            Object.keys(quoteData).forEach(kiteSym => {
                const item = quoteData[kiteSym];
                const token = item.instrument_token;
                
                // Store Quote/OHLC in memory mapping (Token -> Quote)
                // We need to map it back to our internal symbol if possible
                const internalSymbol = this.tokenMap[token];
                if (internalSymbol) {
                    if (!this.currentQuotes) this.currentQuotes = {};
                    this.currentQuotes[internalSymbol] = item;
                }

                pseudoTicks.push({
                    instrument_token: token,
                    last_price: item.last_price,
                    mode: 'quote' 
                });
            });

            if (pseudoTicks.length > 0) {
                logger.info(`Pushing ${pseudoTicks.length} initial Quote updates to frontend`);
                this.processLiveTicks(pseudoTicks, 'kite');
            }

        } catch (error) {
            logger.error('Error fetching initial Quote:', error);
        }
    }



    processLiveTicks(ticks, provider) {
        if (!Array.isArray(ticks)) return;

        if (provider === 'kite') {
            this.kiteTickCount += ticks.length;
            if (this.kiteTickCount % 100 === 0) logger.info(`[KITE_STATS] Total Ticks: ${this.kiteTickCount}`);
            // ... keys
        } else if (provider === 'alltick') {
            this.allTickTickCount += ticks.length;
            if (this.allTickTickCount % 10 === 0) logger.info(`[ALLTICK_STATS] Incoming batch of ${ticks.length} ticks. Total: ${this.allTickTickCount}`);
        }

        ticks.forEach(tick => {
            let symbol = tick.symbol;
            
            // Map Token to Symbol for Kite
            if (provider === 'kite' && tick.instrument_token) {
                 symbol = this.tokenMap[tick.instrument_token];
            }

            if (!symbol) return;
            
            // Optimization: Do NOT invalidate on every tick.
            // Cache invalidation for History/Quotes should be time-based or event-based, not tick-based.
            // cacheManager.invalidateOnWebSocket(symbol);

            const price = tick.last_price;
            this.currentPrices[symbol] = price;

            // Maintain OHLC in memory
            if (!this.currentQuotes) this.currentQuotes = {};
            if (!this.currentQuotes[symbol]) {
                this.currentQuotes[symbol] = {
                    last_price: price,
                    ohlc: { open: price, high: price, low: price, close: price },
                    bid: 0, ask: 0, volume: 0
                };
            }

            const quote = this.currentQuotes[symbol];
            quote.last_price = price;
            
            // Update OHLC from Provider Data (Prioritize official values)
            if (tick.ohlc) {
                // Kite Ticker format: tick.ohlc = { open, high, low, close }
                quote.ohlc.open = tick.ohlc.open || quote.ohlc.open;
                quote.ohlc.high = tick.ohlc.high || quote.ohlc.high;
                quote.ohlc.low = tick.ohlc.low || quote.ohlc.low;
            } else {
                // AllTick or Manual Update: Manual High/Low tracking
                if (price > (quote.ohlc.high || 0)) quote.ohlc.high = price;
                if (price < (quote.ohlc.low || 999999999)) quote.ohlc.low = price;
            }
            
            // Calculate Change against Day's Open (Official)
            const open = quote.ohlc.open || price;
            const change = price - open;
            const changePercent = open !== 0 ? (change / open) * 100 : 0;

            // --- VOLUME HANDLING ---
            let incrementalVolume = parseFloat(tick.volume || tick.last_quantity || 0);
            let totalVolume = 0;

            if (provider === 'kite') {
                totalVolume = parseFloat(tick.volume || 0);
            } else {
                // AllTick: Accumulate
                if (!this.cumulativeVolume[symbol]) this.cumulativeVolume[symbol] = 0;
                this.cumulativeVolume[symbol] += incrementalVolume;
                totalVolume = this.cumulativeVolume[symbol];
            }

            // Update Bid/Ask
            const newBid = parseFloat(tick.bid || (tick.depth?.buy?.[0]?.price) || 0);
            const newAsk = parseFloat(tick.ask || (tick.depth?.sell?.[0]?.price) || 0);

            if (newBid > 0) quote.bid = newBid;
            if (newAsk > 0) quote.ask = newAsk;
            quote.volume = totalVolume; 

            // Emit Normalized Event
            const payload = {
                symbol: symbol,
                price: price,
                open: open,
                high: quote.ohlc.high,
                low: quote.ohlc.low,
                change: change,
                changePercent: changePercent,
                volume: incrementalVolume,
                total_volume: totalVolume,
                bid: quote.bid || 0,
                ask: quote.ask || 0,
                timestamp: tick.timestamp || new Date(),
                provider: provider
            };

            this.emit('price_update', payload);
            
            // NEW: Push to Data Pipeline (In-Memory RingBuffer)
            pipeline.push(payload);
            
            // Legacy Redis Fallback (Optional, commented out for optimization target)
            // if (redisClient.status === 'ready') {
            //      redisClient.publish('market_data', JSON.stringify({
            //          ...payload,
            //          last_price: price 
            //      }));
            // }
        });
    }

    async loadSettings() {
        const settings = await Setting.find({ 
            key: { $regex: '^(data_feed_|kite_|fmp_|alltick_)' } 
        });
        
        this.config = {};
        settings.forEach(s => {
            if (s.key.includes('api_key') || s.key.includes('api_secret') || s.key.includes('access_token')) {
                this.config[s.key] = decrypt(s.value);
            } else {
                this.config[s.key] = s.value;
            }
        });
        
        // Load Env Vars overrides
        if (process.env.KITE_API_KEY) this.config.kite_api_key = process.env.KITE_API_KEY;
        if (process.env.KITE_API_SECRET) this.config.kite_api_secret = process.env.KITE_API_SECRET;
        if (process.env.ALLTICK_API_KEY) this.config.alltick_api_key = process.env.ALLTICK_API_KEY;
        if (process.env.FMP_API_KEY) this.config.fmp_api_key = process.env.FMP_API_KEY;
        
        // Initialize Helpers
        if (this.config.alltick_api_key) {
            allTickService.initialize(this.config.alltick_api_key);
        }

        if (this.config.kite_access_token) {
            kiteService.setAccessToken(this.config.kite_access_token);
        }

        // Restart Feeds
        if (this.canGoLive()) {
            await this.startLiveFeed();
        }
    }

    canGoLive() {
        // Can go live if EITHER provider is valid
        const hasKite = !!(this.config.kite_api_key && this.config.kite_api_secret);
        const hasAllTick = !!(this.config.alltick_api_key);
        return hasKite || hasAllTick;
    }

    async startLiveFeed() {
        const promises = [];

        // 1. Start Kite if configured
        if (this.config.kite_api_key && this.config.kite_api_secret) {
            promises.push((async () => {
                try {
                    this.adapter = kiteService;
                    this.adapter.initialize(this.config.kite_api_key, this.config.kite_api_secret);
                    
                    if (this.config.kite_access_token) {
                        this.adapter.setAccessToken(this.config.kite_access_token);
                        this.connectTicker(); // Only Kite uses this local method wrapper
                    } else {
                        logger.warn(`Kite Configured but NO Access Token. Waiting for Login...`);
                    }
                } catch (e) {
                    logger.error('Error initializing Kite Service', e);
                }
            })());
        }

        // 2. Start AllTick if configured
        if (this.config.alltick_api_key) {
             promises.push((async () => {
                 try {
                    // Initialize WebSocket Manager (Partitioning/Pooling)
                    websocketManager.init(this);
                    
                    // We STILL need to connect the Main Ticker for non-pooled events?
                    // Actually, WebSocketManager handles data via Pool.
                    // But we might need one connection for "General" stuff or just rely on Manager.
                    // The original code used `allTickService.connectTicker`.
                    // If we switch to Manager, do we still need `connectTicker`? 
                    // `websocketManager` manages connections.
                    // But `subscribeToSymbols` calls `websocketManager.updateViewport`.
                    // So we probably don't need `connectTicker` for AllTick anymore in the old way.
                    
                    // However, we should ensure `allTickService` is initialized with token.
                    // It is (line 506).
                    
                    // Let's keep `connectTicker` for now as a fallback or for "Global" market events, 
                    // OR disable it if Manager covers everything.
                    // Manager covers QUOTES and DEPTH.
                    // If we disable `connectTicker`, we rely solely on Manager.
                    
                    logger.info('WebSocket Manager Initialized for AllTick');
                    this.subscribeToSymbols();

                 } catch (e) {
                     logger.error('Error starting AllTick Feed', e);
                 }
             })());
        }

        await Promise.allSettled(promises);
    }

    connectTicker() {
        if (!this.adapter) return;
        
        this.adapter.connectTicker((ticks) => {
            this.processLiveTicks(ticks, 'kite');
        }, () => {
            logger.info('Kite Live Ticker Connected');
            this.mode = 'live';
            this.subscribeToSymbols();
        });
    }

    getStats() {
        // Return Decoupled Stats
        const stats = {
            provider: this.config?.data_feed_provider || 'none',
            startTime: this.startTime,
            uptime: Math.floor((new Date() - this.startTime) / 1000),
            mode: this.mode,
            
            // Explicit Kite Stats
            kite: {
                connected: this.adapter?.isTickerConnected || false,
                latency: this.adapter?.isTickerConnected ? `${this.kiteLatency}ms` : 'Disconnected',
                tickCount: this.kiteTickCount
            },

            // Explicit AllTick Stats
            alltick: {
                connected: allTickService.isConnected || false,
                latency: allTickService.isConnected ? `${allTickService.latency}ms` : 'Disconnected',
                tickCount: this.allTickTickCount
            },
            
            // DEBUG: Expose current prices to verify initialization
            prices: this.currentPrices || {}
        };

        // Legacy support for flat latency logic (optional, for other consumers)
        // We use the 'Active' provider for the main latency field
        if (stats.provider === 'kite') {
            stats.latency = stats.kite.latency;
            stats.tickCount = stats.kite.tickCount;
        } else {
            stats.latency = stats.alltick.latency;
            stats.tickCount = stats.alltick.tickCount;
        }

        return stats;
    }

    async handleLogin(provider, payload) {
        await this.loadSettings();

        if (provider === 'kite') {
            return this.handleKiteLogin(payload.request_token || payload.code);
        } else {
             throw new Error(`Login provider ${provider} not supported yet`);
        }
    }

    async handleKiteLogin(requestToken) {
         await this.loadSettings();
         if (!this.config.kite_api_key) throw new Error('API Key not configured');

         kiteService.initialize(this.config.kite_api_key, this.config.kite_api_secret);
         const response = await kiteService.generateSession(requestToken);
         
         await Setting.findOneAndUpdate(
             { key: 'kite_access_token' }, 
             { key: 'kite_access_token', value: encrypt(response.access_token), description: 'Kite Access Token' }, 
             { upsert: true }
         );

         this.config.kite_access_token = response.access_token;
         this.mode = 'live';
         this.connectTicker();
         return response;
    }

    async getHistory(symbol, resolution, from, to, priority = null) {
        // Generate Standard Cache Key
        const provider = this.config.data_feed_provider || 'alltick';
        
        // Normalize Dates (Support Seconds, Milliseconds, or Date String)
        // Normalize Dates (Support Seconds, Milliseconds, or Date String)
        const parseTs = (val) => {
             if (!val) return Math.floor(Date.now() / 1000);
             // CRITICAL: Handle Date objects first because isNaN(Date) is false but parseInt(Date) is NaN
             if (val instanceof Date) return Math.floor(val.getTime() / 1000);
             
             if (!isNaN(val)) {
                  const num = Number(val);
                  // Standard heuristic: Timestamps > 10 billion are ms
                  return num > 10000000000 ? Math.floor(num / 1000) : Math.floor(num);
             }
             const d = new Date(val);
             return !isNaN(d.getTime()) ? Math.floor(d.getTime() / 1000) : Math.floor(Date.now() / 1000);
        };

        const fromTs = parseTs(from);
        const toTs = to ? parseTs(to) : Math.floor(Date.now() / 1000);
        
        // Normalize for Deduplication & Caching (Round to 30s)
        const toTsNormal = Math.floor(toTs / 30) * 30;
        const fromTsNormal = Math.floor(fromTs / 30) * 30;
        
        // Cache Key: "history_BTCUSD_5_170000_171000"
        const cacheKey = `history_${symbol}_${resolution}_${fromTsNormal}_${toTsNormal}`;
        
        // 1. Unified Cache Check (L1 -> L2 -> L3)
        return cacheManager.getOrFetch(cacheKey, async () => {
            
            // 2. Direct Call (Provider handles its own queuing/limits)
            logger.debug(`[MarketData] Fetching History: ${symbol} (${resolution}) via ${provider}`);
            
            try {
                let data = [];
                
                const isGlobalSymbol = ['XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD', 'EURUSD'].includes(symbol) || 
                                     (this.symbols[symbol] && ['FOREX', 'CRYPTO', 'BINANCE'].includes(this.symbols[symbol].exchange));

                const isKiteRequest = !isGlobalSymbol && (provider === 'kite' || (this.symbols[symbol]?.instrumentToken && this.config.kite_api_key));
                logger.info(`[MarketData-Trace] Symbol: ${symbol}, Provider: ${provider}, IsKite: ${isKiteRequest}`);

                if (isKiteRequest) {
                        // Check if Kite Auth is globally broken to avoid clogging queue with known failures
                        if (this.kiteAuthBrokenUntil && Date.now() < this.kiteAuthBrokenUntil) {
                            logger.warn(`[MarketData] Skipping Kite history for ${symbol} - Auth recently failed.`);
                            return [];
                        }

                        // --- KITE STRATEGY ---
                        // Pass Date objects derived from safe timestamps
                        data = await this._fetchKiteHistory(symbol, resolution, new Date(fromTsNormal * 1000), new Date(toTsNormal * 1000));
                        // No extra mapping needed here
                } else {
                        // --- ALLTICK STRATEGY (Crypto/Forex/Fallback) ---
                        // AllTickService handles its own Rate Limiting via RequestQueue internally.
                        logger.info(`[MarketData-Trace] Delegating to AllTick for ${symbol}`);
                        const isRecent = (Date.now() / 1000) - toTsNormal < 3600; 
                        const effectivePriority = priority || (isRecent ? 1 : 2);
                        data = await allTickService.getHistoricalData(symbol, resolution, new Date(fromTsNormal * 1000), new Date(toTsNormal * 1000), effectivePriority);
                }

                if (!Array.isArray(data)) {
                    logger.warn(`[MarketData] Fetch Returned NON-ARRAY for ${symbol}`);
                    return [];
                }
                
                logger.info(`[History Debug] ${symbol}: Returned ${data.length} candles. First: ${JSON.stringify(data[0])}`);
                return data.filter(c => c && c.time && c.close !== undefined);

            } catch (e) {
                if (e.message?.includes('403') || e.message?.includes('Incorrect api_key') || e.message?.includes('401')) {
                    logger.error(`[MarketData] Kite AUTH FAILURE detected. Disabling Kite history for 5 minutes.`);
                    this.kiteAuthBrokenUntil = Date.now() + (5 * 60 * 1000); // 5 min cooldown
                }
                logger.error(`[MarketData] Fetch Failed ${symbol}: ${e.message}`);
                return []; // Return empty instead of throwing to unblock UI/Queue
            }

        }, '24h');
    }

    // Extracted Kite logic from original getHistory
    async _fetchKiteHistory(symbol, resolution, from, to) {
        const masterSymbol = this.symbols[symbol];
        let interval = 'minute';
        // Mapping Logic
        if (resolution === '1') interval = 'minute';
        else if (resolution === '3') interval = '3minute';
        else if (resolution === '5') interval = '5minute';
        else if (resolution === '15') interval = '15minute';
        else if (resolution === '30') interval = '30minute';
        else if (resolution === '60' || resolution === '1h') interval = '60minute';
        else if (resolution === 'D' || resolution === '1D') interval = 'day';

        // Range Clamping logic (Kite limits per request, not necessarily total retention)
        // If we want to support older data, we should paginate, but for now let's just respect the TO date.
        const now = Math.floor(Date.now() / 1000);
        let safeFrom = new Date(from).getTime() / 1000;
        
        // Only clamp strict lookback if necessary, but don't break the range
        // For debugging, we remove the logic that shifts 'from' past 'to'
        // let maxDays = 60;
        // if (interval === 'day') maxDays = 2000;
        // else if (interval === '60minute') maxDays = 400;
        // if (now - safeFrom > maxDays * 86400) safeFrom = now - (maxDays * 86400);

        if (safeFrom > new Date(to).getTime() / 1000) {
             logger.warn(`[KITE] Adjusted 'from' date was after 'to' date. Resetting to 'to' - interval.`);
             safeFrom = (new Date(to).getTime() / 1000) - 86400; // Fallback to 1 day before TO
        }

        logger.info(`[HISTORY_DEBUG] Fetching Kite History for ${symbol} (Token: ${masterSymbol.instrumentToken}). Range: ${new Date(safeFrom * 1000).toISOString()} to ${new Date(to).toISOString()}`);

        const data = await kiteService.getHistoricalData(
            masterSymbol.instrumentToken, 
            interval, 
            new Date(safeFrom * 1000), 
            new Date(to)
        );
        
        return data;
    }


    async searchInstruments(query = '') {
        try {
            let kiteResults = [];
            let allTickResults = [];
            const safeQuery = typeof query === 'string' ? query : '';

            // 1. Kite Search
            if (this.config && this.config.kite_api_key) {
                try {
                    kiteResults = await kiteInstrumentsService.search(safeQuery);
                } catch (e) {
                    logger.error(`Kite search error: ${e.message}`);
                }
            }

            // 2. AllTick Search
            try {
                // Even without API key, use service for potential fallback or handling
                allTickResults = await allTickService.search(safeQuery);
            } catch (e) {
                logger.error(`AllTick search error: ${e.message}`);
            }

            // 3. Hardcoded Master List (Fallback & Priority)
            const popular = [
                // INDICES
                { symbol: 'NSE:NIFTY 50-INDEX', name: 'Nifty 50', segment: 'INDICES', exchange: 'NSE', lotSize: 50, tickSize: 0.05 },
                { symbol: 'NSE:NIFTY BANK-INDEX', name: 'Nifty Bank', segment: 'INDICES', exchange: 'NSE', lotSize: 15, tickSize: 0.05 },
                { symbol: 'BSE:SENSEX-INDEX', name: 'Sensex', segment: 'INDICES', exchange: 'BSE', lotSize: 10, tickSize: 0.05 },
                { symbol: 'NSE:FINNIFTY-INDEX', name: 'Nifty Fin Service', segment: 'INDICES', exchange: 'NSE', lotSize: 40, tickSize: 0.05 },
                
                // STOCKS (Major)
                { symbol: 'NSE:RELIANCE-EQ', name: 'Reliance Industries', segment: 'EQUITY', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
                { symbol: 'NSE:TCS-EQ', name: 'Tata Consultancy Services', segment: 'EQUITY', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
                { symbol: 'NSE:HDFCBANK-EQ', name: 'HDFC Bank', segment: 'EQUITY', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
                { symbol: 'NSE:INFY-EQ', name: 'Infosys', segment: 'EQUITY', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
                { symbol: 'NSE:ICICIBANK-EQ', name: 'ICICI Bank', segment: 'EQUITY', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
                { symbol: 'NSE:SBIN-EQ', name: 'State Bank of India', segment: 'EQUITY', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
                { symbol: 'NSE:BHARTIARTL-EQ', name: 'Bharti Airtel', segment: 'EQUITY', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
                { symbol: 'NSE:ITC-EQ', name: 'ITC Ltd', segment: 'EQUITY', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
                { symbol: 'NSE:KOTAKBANK-EQ', name: 'Kotak Mahindra Bank', segment: 'EQUITY', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },
                { symbol: 'NSE:LT-EQ', name: 'Larsen & Toubro', segment: 'EQUITY', exchange: 'NSE', lotSize: 1, tickSize: 0.05 },

                // GLOBAL / CRYPTO
                { symbol: 'BTCUSD', name: 'Bitcoin USD', segment: 'CRYPTO', exchange: 'BINANCE', lotSize: 1, tickSize: 0.01 },
                { symbol: 'ETHUSD', name: 'Ethereum USD', segment: 'CRYPTO', exchange: 'BINANCE', lotSize: 1, tickSize: 0.01 },
                // Use 'FOREX' exchange for Global/Currencies, but ensure Plan 'CURRENCY' allows 'FOREX'
                { symbol: 'EURUSD', name: 'Euro / US Dollar', segment: 'CURRENCY', exchange: 'FOREX', lotSize: 1, tickSize: 0.0001 },
                // Use 'FOREX' for Commodities like Gold if data comes from global provider, but Segment MUST be COMMODITY
                { symbol: 'XAUUSD', name: 'Gold / US Dollar', segment: 'COMMODITY', exchange: 'FOREX', lotSize: 1, tickSize: 0.01 },
                { symbol: 'XAGUSD', name: 'Silver / US Dollar', segment: 'COMMODITY', exchange: 'FOREX', lotSize: 1, tickSize: 0.001 },
                // Add Crude Oil if missing
                { symbol: 'MCX:CRUDEOIL24NOVFUT', name: 'Crude Oil', segment: 'COMMODITY', exchange: 'MCX', lotSize: 100, tickSize: 1.00 }
            ];

            // 4. Database Search
            const dbSymbols = await MasterSymbol.find({
                $or: [
                    { symbol: { $regex: safeQuery, $options: 'i' } },
                    { name: { $regex: safeQuery, $options: 'i' } }
                ]
            }).limit(10);

            const dbMapped = dbSymbols.map(s => ({
                symbol: s.symbol,
                name: s.name,
                segment: s.segment,
                exchange: s.exchange,
                lotSize: s.lotSize,
                tickSize: s.tickSize || 0.05
            }));

            // Filter Popular List
            const q = safeQuery.toUpperCase();
            const filteredPopular = popular.filter(p => 
                p.symbol.includes(q) || 
                p.name.toUpperCase().includes(q)
            );

            // Merge & Unique
            const combined = [...dbMapped, ...kiteResults, ...allTickResults, ...filteredPopular];
            const unique = Array.from(new Map(combined.map(item => [item.symbol, item])).values());

            return unique.slice(0, 50);

        } catch (error) {
            logger.error(`Critical Error in searchInstruments: ${error.message}`);
            // Return empty array instead of 500 to keep UI alive
            return [];
        }
    }

    /**
     * Get historical OHLC data for a symbol
     * @param {string} symbol - Symbol name (e.g., 'EURUSD', 'NIFTY 50')
     * @param {string} resolution - Timeframe (1, 5, 15, 30, 60, 1D, etc.)
     * @param {number|string} from - Start timestamp (seconds)
     * @param {number|string} to - End timestamp (seconds)
     * @returns {Promise<Array>} Array of OHLC candles
     */

}

const marketDataService = new MarketDataService();
export default marketDataService;

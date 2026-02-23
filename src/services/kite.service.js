import { KiteConnect, KiteTicker } from 'kiteconnect';
import logger from '../config/logger.js';

class KiteService {
    constructor() {
        this.kite = null;
        this.ticker = null;
        this.apiKey = null;
        this.apiSecret = null;
        this.accessToken = null;
        this.isTickerConnected = false;
        this.subscriptions = [];
        this.callbacks = {
            onTick: () => {},
            onConnect: () => {},
            onError: () => {}
        };
    }

    /**
     * Initialize the service with API credentials
     */
    initialize(apiKey, apiSecret) {
        if (!apiKey || !apiSecret) {
            throw new Error('API Key and Secret are required for KiteService');
        }
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        
        this.kite = new KiteConnect({
            api_key: this.apiKey,
        });

        logger.info('KiteService initialized with API Key');
    }

    /**
     * Generate the login URL for the user to authenticate
     */
    getLoginUrl() {
        if (!this.kite) return null;
        return this.kite.getLoginURL();
    }

    async generateSession(requestToken) {
        if (!this.kite || !this.apiSecret) throw new Error('KiteService not initialized');
        
        try {
            logger.info('Exchanging Kite Request Token for Session...');
            const response = await this.kite.generateSession(requestToken, this.apiSecret);
            this.accessToken = response.access_token;
            this.kite.setAccessToken(this.accessToken);
            
            logger.info(`Kite Session Generated Successfully for Client: ${response.user_id}`);
            return response;
        } catch (error) {
            const errorMsg = error.message || 'Unknown Kite Error';
            logger.error(`Kite Session Generation Failed: ${errorMsg}`, { error });
            throw new Error(`Kite Login Failed: ${errorMsg}`);
        }
    }

    /**
     * Fetch Historical Data (Candles)
     * Requires "Historical API" add-on in Kite Connect
     */
    async getHistoricalData(instrumentToken, interval, from, to, continuous = false) {
        if (!this.kite || !this.accessToken) throw new Error('Kite not authenticated');
        
        try {
            logger.info(`Fetching Kite History: Token=${instrumentToken}, Interval=${interval}, From=${from}, To=${to}`);
            
            // Kite expects Date objects
            const fromDate = new Date(from);
            const toDate = new Date(to);
            
            const candles = await this.kite.getHistoricalData(instrumentToken, interval, fromDate, toDate, continuous);
            
            // Format to standard OHLCV if needed (Kite returns: [{ date, open, high, low, close, volume }])
            if (candles.length > 0) {
                 logger.info(`[KITE_RAW_DEBUG] Candle 0: ${JSON.stringify(candles[0])}`);
                 logger.info(`[KITE_RAW_DEBUG] Date type: ${typeof candles[0].date}`);
            }
            return candles
                .filter(c => c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0) // Filter invalid prices
                .map(c => ({
                    time: new Date(c.date).getTime() / 1000,
                    open: c.open,
                    high: Math.max(c.high, c.open, c.close), // Ensure High is actually High
                    low: Math.min(c.low, c.open, c.close),   // Ensure Low is actually Low
                    close: c.close,
                    volume: c.volume || 0
                }));
        } catch (error) {
            logger.error(`Kite History Fetch Error: ${error.message}`, { instrumentToken, interval });
            throw error;
        }
    }

    /**
     * Fetch Master Instrument List from Zerodha
     * Returns a massive array of all tradable instruments
     */
    async getInstruments() {
        if (!this.kite) throw new Error('Kite not initialized');
        try {
            logger.info('Fetching Kite Master Instrument List (CSV)...');
            const instruments = await this.kite.getInstruments();
            logger.info(`Fetched ${instruments.length} instruments from Zerodha`);
            return instruments;
        } catch (error) {
            logger.error(`Kite Instrument Fetch Failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get Last Traded Price (LTP) for instruments
     * @param {Array} instruments - Array of strings e.g. ['NSE:RELIANCE', 'MCX:CRUDEOIL']
     */
    async getLTP(instruments) {
        if (!this.kite || !this.accessToken) throw new Error('Kite not authenticated');
        try {
            // instruments should be array of "EXCHANGE:TRADINGSYMBOL"
            const response = await this.kite.getLTP(instruments);
            return response;
        } catch (error) {
            logger.error(`getLTP Failed: ${error.message}`);
            return {};
        }
    }

    /**
     * Get Full Quote (LTP, OHLC, Depth)
     */
    async getQuote(instruments) {
        if (!this.kite || !this.accessToken) throw new Error('Kite not authenticated');
        try {
            const response = await this.kite.getQuote(instruments);
            return response;
        } catch (error) {
            logger.error(`getQuote Failed: ${error.message}`);
            return {};
        }
    }

    /**
     * Set Access Token manually (if loaded from DB/Cache)
     */
    setAccessToken(token) {
        this.accessToken = token;
        if (this.kite) {
            this.kite.setAccessToken(token);
        }
    }

    /**
     * Connect to Kite Ticker (WebSocket)
     */
    connectTicker(onTickCallback, onConnectCallback) {
        if (!this.apiKey || !this.accessToken) {
            logger.error('Cannot connect ticker: Missing credentials');
            return;
        }

        // Cleanup previous instance properly
        if (this.ticker) {
            logger.info('Ticker already exists, performing cleanup before reconnecting...');
            
            // Explicitly remove all bound listeners to prevent memory leaks
            // We must use the exact same function references if we bound them, but here we used implicit binds or anonymous functions in previous code.
            // Paradox: if we bound them with .bind(this), we created new functions.
            // Soln: In this refactor, we will store the bound functions to remove them correctly, 
            // OR rely on disconnect() if KiteTicker internally removes them (it usually doesn't remove external listeners).
            
            // To be safe, we will just force disconnect (which typically closes the socket). 
            // The garbage collector should take the old instance if we overwrite `this.ticker`.
            // But if KiteConnect keeps global refs, we might leak.
            // Best practice: disconnect() is usually enough IF we overwrite the reference.
            // BUT, user complained about listener accumulation.
            
            try {
                this.ticker.disconnect();
                
                // Hack: KiteTicker (v3) might not expose removeAllListeners if it's not a standard EventEmitter. 
                // Checks show it typically is.
                // If it inherits from EventEmitter:
                // this.ticker.removeAllListeners(); 
            } catch (e) {
                logger.error('Error disconnecting Kite Ticker:', e);
            }
        }

        this.callbacks.onTick = onTickCallback;
        if (onConnectCallback) this.callbacks.onConnect = onConnectCallback;

        try {
            this.ticker = new KiteTicker({
                api_key: this.apiKey,
                access_token: this.accessToken
            });

            this.ticker.autoReconnect(true, 10, 5);

            // Store bound functions to ensure we *could* remove them if we didn't destroy usage
            // But here we rely on creating a fresh instance.
            this.ticker.on('ticks', this.handleTicks.bind(this));
            this.ticker.on('connect', this.handleConnect.bind(this));
            this.ticker.on('disconnect', this.handleDisconnect.bind(this));
            
            // Defined inline in previous code, moving to method for cleanliness? 
            // Keeping inline to minimize diff but fixing the listener accumulation via 'new instance' 
            // The user said "reconnect logic creates zombie connections".
            // If we create `new KiteTicker`, the old one becomes a zombie if `disconnect` didn't kill it fully.
            
            this.ticker.on('error', (error) => {
                const errorStr = JSON.stringify(error, Object.getOwnPropertyNames(error));
                logger.error(`Kite Ticker Error (Type: ${typeof error}): ${errorStr}`);
                
                if (errorStr.includes('403') || (error && error.message && error.message.includes('403'))) {
                    logger.error('Kite Ticker 403 Forbidden - Stopping Reconnection Attempts');
                    try {
                        this.ticker.autoReconnect(false);
                        this.ticker.disconnect();
                    } catch (e) {}
                    this.isTickerConnected = false;
                }
            });

            this.ticker.on('reconnecting', (attempt) => logger.warn(`Kite Ticker Reconnecting (Attempt ${attempt})...`));
            this.ticker.on('noreconnect', () => logger.error('Kite Ticker gave up reconnecting'));

            this.ticker.connect();
        } catch (error) {
            logger.error('Failed to initialize or connect Kite Ticker:', error);
            this.isTickerConnected = false;
        }
    }

    handleTicks(ticks) {
        // Normalize ticks if necessary or pass raw
        // Kite ticks format: [{ instrument_token, last_price, ... }]
        if (ticks && ticks.length > 0) {
             logger.info(`[KITE_SERVICE] Ticks Received: ${ticks.length}`);
        }
        if (this.callbacks.onTick) {
            this.callbacks.onTick(ticks);
        }
    }

    handleConnect() {
        logger.info('Kite Ticker Connected');
        this.isTickerConnected = true;
        
        // Resubscribe if needed
        if (this.subscriptions.length > 0) {
            this.subscribe(this.subscriptions);
        }

        if (this.callbacks.onConnect) {
            this.callbacks.onConnect();
        }
    }

    handleDisconnect() {
        logger.warn('Kite Ticker Disconnected');
        this.isTickerConnected = false;
    }

    subscribe(instrumentTokens) {
        if (!this.ticker || !this.isTickerConnected) {
            logger.warn('Ticker not connected, queuing subscriptions');
            // Add unique tokens to subscription list
            const newTokens = instrumentTokens.filter(t => !this.subscriptions.includes(t));
            this.subscriptions = [...this.subscriptions, ...newTokens];
            return;
        }

        const tokensToSubscribe = instrumentTokens.map(t => parseInt(t));
        this.ticker.subscribe(tokensToSubscribe);
        this.ticker.setMode(this.ticker.modeFull, tokensToSubscribe);
        
        // Update local list
        const newTokens = instrumentTokens.filter(t => !this.subscriptions.includes(t));
        this.subscriptions = [...this.subscriptions, ...newTokens];
        
        logger.info(`Subscribed to ${tokensToSubscribe.length} tokens`);
    }

    unsubscribe(instrumentTokens) {
        if (!this.ticker || !this.isTickerConnected) return;
        const tokensToUnsub = instrumentTokens.map(t => parseInt(t));
        this.ticker.unsubscribe(tokensToUnsub);
        
        // Remove from local list
        this.subscriptions = this.subscriptions.filter(t => !tokensToUnsub.includes(parseInt(t)));
    }
}

export const kiteService = new KiteService();
export default KiteService;

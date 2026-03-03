import WebSocket from 'ws';
import logger from '../config/log.js';

class Mt5Service {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.subscriptions = new Set();
        this.url = null;
        this.marketDataService = null;
        this._reconnectTimer = null;
        this._lastConnectAt = 0;
    }

    init(url, marketDataService) {
        if (!url) {
            logger.warn('[MT5] Missing MT5_WS_URL. MT5 service disabled.');
            return;
        }
        this.url = url;
        this.marketDataService = marketDataService;
        this._connect();
    }

    _connect() {
        if (!this.url) return;
        const now = Date.now();
        if (now - this._lastConnectAt < 2000) return;
        this._lastConnectAt = now;

        try {
            this.ws = new WebSocket(this.url);

            this.ws.on('open', () => {
                this.isConnected = true;
                logger.info('[MT5] WebSocket connected');
                if (this.subscriptions.size > 0) {
                    this._send({
                        action: 'set_symbols',
                        symbols: Array.from(this.subscriptions)
                    });
                }
            });

            this.ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg?.type === 'market_data' && Array.isArray(msg.data)) {
                        const ticks = msg.data
                            .filter(item => item && !item.error)
                            .map(item => {
                                const last = item.last && item.last > 0 ? item.last : (item.close || item.bid || item.ask || 0);
                                return {
                                    symbol: item.requested || item.symbol,
                                    last_price: last,
                                    ohlc: {
                                        open: item.open,
                                        high: item.high,
                                        low: item.low,
                                        close: item.close || last
                                    },
                                    bid: item.bid,
                                    ask: item.ask,
                                    volume: item.volume,
                                    timestamp: item.time ? new Date(item.time * 1000) : new Date()
                                };
                            });

                        if (ticks.length > 0 && this.marketDataService) {
                            this.marketDataService.processLiveTicks(ticks, 'mt5');
                        }
                    }
                } catch (e) {
                    logger.error(`[MT5] Message parse error: ${e.message}`);
                }
            });

            this.ws.on('close', () => {
                this.isConnected = false;
                logger.warn('[MT5] WebSocket disconnected');
                this._scheduleReconnect();
            });

            this.ws.on('error', (err) => {
                this.isConnected = false;
                logger.error(`[MT5] WebSocket error: ${err.message}`);
                this._scheduleReconnect();
            });
        } catch (e) {
            logger.error(`[MT5] Connection failed: ${e.message}`);
            this._scheduleReconnect();
        }
    }

    _scheduleReconnect() {
        if (this._reconnectTimer) return;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._connect();
        }, 5000);
    }

    _send(payload) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify(payload));
    }

    subscribe(symbols = []) {
        const list = Array.isArray(symbols) ? symbols : [symbols];
        list.forEach(sym => {
            if (sym) this.subscriptions.add(sym);
        });
        if (this.isConnected) {
            this._send({ action: 'subscribe', symbols: list });
        }
    }

    unsubscribe(symbols = []) {
        const list = Array.isArray(symbols) ? symbols : [symbols];
        list.forEach(sym => this.subscriptions.delete(sym));
        if (this.isConnected) {
            this._send({ action: 'unsubscribe', symbols: list });
        }
    }
}

export const mt5Service = new Mt5Service();
export default mt5Service;

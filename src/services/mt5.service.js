import WebSocket from 'ws';
import logger from '../config/log.js';

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 30000;

const toArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null) return [];
    return [value];
};

class Mt5Service {
    constructor() {
        this.ws = null;
        this.url = null;
        this.apiKey = '';
        this.intervalMs = 300;

        this.marketDataService = null;

        this.subscriptions = new Set();
        this.isConnected = false;

        this._isConnecting = false;
        this._reconnectTimer = null;
        this._reconnectAttempt = 0;
        this._manualClose = false;
    }

    get subscriptionCount() {
        return this.subscriptions.size;
    }

    init(optionsOrUrl, marketDataServiceArg = null) {
        const options = typeof optionsOrUrl === 'string'
            ? {
                url: optionsOrUrl,
                marketDataService: marketDataServiceArg,
            }
            : (optionsOrUrl || {});

        const nextUrl = String(options.url || '').trim();
        if (!nextUrl) {
            logger.warn('[MARKET_DATA_WS] Missing websocket URL. Service disabled.');
            return;
        }

        this.url = nextUrl;
        this.apiKey = String(options.apiKey || '').trim();

        const parsedInterval = Number.parseInt(options.intervalMs, 10);
        this.intervalMs = Number.isFinite(parsedInterval) && parsedInterval >= 0 ? parsedInterval : 300;

        if (options.marketDataService) {
            this.marketDataService = options.marketDataService;
        }

        this._manualClose = false;

        if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
            this._send({ action: 'set_interval', interval_ms: this.intervalMs });
            this._send({ action: 'set_symbols', symbols: Array.from(this.subscriptions) });
            return;
        }

        if (!this._isConnecting) {
            this._connect();
        }
    }

    shutdown() {
        this._manualClose = true;
        this.isConnected = false;

        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        try {
            this.ws?.close();
        } catch (error) {
            logger.debug(`[MARKET_DATA_WS] Shutdown close error: ${error.message}`);
        }

        this.ws = null;
    }

    _buildConnectionUrl() {
        const url = new URL(this.url);

        if (this.apiKey) {
            url.searchParams.set('key', this.apiKey);
        }

        return url.toString();
    }

    _connect() {
        if (!this.url || this._manualClose || this._isConnecting) return;

        this._isConnecting = true;

        try {
            const wsUrl = this._buildConnectionUrl();
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                this._isConnecting = false;
                this.isConnected = true;
                this._reconnectAttempt = 0;

                logger.info('[MARKET_DATA_WS] Connected');

                this._send({ action: 'set_interval', interval_ms: this.intervalMs });
                this._send({ action: 'set_symbols', symbols: Array.from(this.subscriptions) });
            });

            this.ws.on('message', (rawData) => {
                this._handleMessage(rawData);
            });

            this.ws.on('close', (code, reasonBuffer) => {
                const reason = reasonBuffer ? reasonBuffer.toString() : '';
                this.isConnected = false;
                this._isConnecting = false;

                logger.warn(`[MARKET_DATA_WS] Disconnected (code=${code}${reason ? `, reason=${reason}` : ''})`);
                this._scheduleReconnect();
            });

            this.ws.on('error', (error) => {
                this.isConnected = false;
                this._isConnecting = false;

                logger.error(`[MARKET_DATA_WS] Error: ${error.message}`);
                this._scheduleReconnect();
            });
        } catch (error) {
            this.isConnected = false;
            this._isConnecting = false;

            logger.error(`[MARKET_DATA_WS] Connection failed: ${error.message}`);
            this._scheduleReconnect();
        }
    }

    _handleMessage(rawData) {
        try {
            const message = JSON.parse(rawData.toString());

            if (message?.type === 'control_error') {
                logger.warn(`[MARKET_DATA_WS] Control error: ${message.error || 'unknown_error'} ${message.message || ''}`.trim());
                return;
            }

            if (message?.type !== 'market_data' || !Array.isArray(message.data)) {
                return;
            }

            const nowMs = Date.now();

            const ticks = message.data
                .filter((item) => item && !item.error)
                .map((item) => {
                    const tickTimeMs = Number(item.time) > 0 ? Number(item.time) * 1000 : nowMs;
                    const last = Number(item.last) > 0
                        ? Number(item.last)
                        : (Number(item.close) > 0 ? Number(item.close) : (Number(item.bid) > 0 ? Number(item.bid) : Number(item.ask) || 0));
                    const openRaw = Number(item.open);
                    const highRaw = Number(item.high);
                    const lowRaw = Number(item.low);
                    const closeRaw = Number(item.close);
                    const dayOpenRaw = Number(item.day_open);
                    const dayHighRaw = Number(item.day_high);
                    const dayLowRaw = Number(item.day_low);
                    const dayCloseRaw = Number(item.day_close);
                    const hasDayOhlc =
                        (Number.isFinite(dayOpenRaw) && dayOpenRaw > 0) ||
                        (Number.isFinite(dayHighRaw) && dayHighRaw > 0) ||
                        (Number.isFinite(dayLowRaw) && dayLowRaw > 0) ||
                        (Number.isFinite(dayCloseRaw) && dayCloseRaw > 0);
                    const hasBarOhlc =
                        (Number.isFinite(openRaw) && openRaw > 0) ||
                        (Number.isFinite(highRaw) && highRaw > 0) ||
                        (Number.isFinite(lowRaw) && lowRaw > 0) ||
                        (Number.isFinite(closeRaw) && closeRaw > 0);
                    const hasOhlc = hasDayOhlc || hasBarOhlc;
                    const activeOpen = hasDayOhlc ? dayOpenRaw : openRaw;
                    const activeHigh = hasDayOhlc ? dayHighRaw : highRaw;
                    const activeLow = hasDayOhlc ? dayLowRaw : lowRaw;
                    const activeClose = hasDayOhlc ? dayCloseRaw : closeRaw;
                    const sessionEpoch = Number(item.day_time);
                    const sessionId = Number.isFinite(sessionEpoch) && sessionEpoch > 0
                        ? `D1:${Math.floor(sessionEpoch)}`
                        : undefined;

                    return {
                        symbol: item.requested || item.symbol,
                        last_price: last,
                        ohlc: hasOhlc
                            ? {
                                open: (Number.isFinite(activeOpen) && activeOpen > 0) ? activeOpen : last,
                                high: (Number.isFinite(activeHigh) && activeHigh > 0) ? activeHigh : undefined,
                                low: (Number.isFinite(activeLow) && activeLow > 0) ? activeLow : undefined,
                                close: (Number.isFinite(activeClose) && activeClose > 0) ? activeClose : last,
                            }
                            : undefined,
                        session_id: sessionId,
                        bid: Number(item.bid) || 0,
                        ask: Number(item.ask) || 0,
                        total_volume: Number(item.volume) || 0,
                        volume: Number(item.volume) || 0,
                        timestamp: new Date(tickTimeMs),
                        _latencyMs: Math.max(0, nowMs - tickTimeMs),
                    };
                })
                .filter((tick) => tick.symbol && Number.isFinite(tick.last_price));

            if (ticks.length > 0 && this.marketDataService) {
                this.marketDataService.processLiveTicks(ticks, 'market_data');
            }
        } catch (error) {
            logger.error(`[MARKET_DATA_WS] Message parse error: ${error.message}`);
        }
    }

    _scheduleReconnect() {
        if (this._manualClose || this._reconnectTimer) return;

        this._reconnectAttempt += 1;
        const delay = Math.min(RECONNECT_BASE_MS * (2 ** Math.max(0, this._reconnectAttempt - 1)), RECONNECT_MAX_MS);

        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._connect();
        }, delay);

        logger.info(`[MARKET_DATA_WS] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempt})`);
    }

    _send(payload) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        try {
            this.ws.send(JSON.stringify(payload));
        } catch (error) {
            logger.error(`[MARKET_DATA_WS] Send error: ${error.message}`);
        }
    }

    subscribe(symbols = []) {
        const list = toArray(symbols)
            .map((value) => String(value || '').trim())
            .filter(Boolean);

        if (list.length === 0) return;

        for (const symbol of list) {
            this.subscriptions.add(symbol);
        }

        if (this.isConnected) {
            this._send({ action: 'subscribe', symbols: list });
        }
    }

    unsubscribe(symbols = []) {
        const list = toArray(symbols)
            .map((value) => String(value || '').trim())
            .filter(Boolean);

        if (list.length === 0) return;

        for (const symbol of list) {
            this.subscriptions.delete(symbol);
        }

        if (this.isConnected) {
            this._send({ action: 'unsubscribe', symbols: list });
        }
    }

    setInterval(intervalMs) {
        const parsed = Number.parseInt(intervalMs, 10);
        if (!Number.isFinite(parsed) || parsed < 0) return;

        this.intervalMs = parsed;
        if (this.isConnected) {
            this._send({ action: 'set_interval', interval_ms: parsed });
        }
    }
}

export const mt5Service = new Mt5Service();
export default mt5Service;

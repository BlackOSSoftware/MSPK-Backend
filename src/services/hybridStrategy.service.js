import marketDataService from './marketData.service.js';
import technicalAnalysisService from './technicalAnalysis.service.js';
import signalService from './signal.service.js';
import logger from '../config/logger.js';
import Strategy from '../models/Strategy.js';
import Signal from '../models/Signal.js';
import EventEmitter from 'events';
import { broadcastToRoom, broadcastToAll } from './websocket.service.js';

class HybridStrategyService extends EventEmitter {
    constructor() {
        super();
        
        // Multi-Timeframe State
        this.timeframes = ['5m', '15m', '1h']; // Client Priority
        this.tfMapSeconds = { 
            '1m': 60, 
            '3m': 180, 
            '5m': 300, 
            '15m': 900, 
            '30m': 1800, 
            '1h': 3600, 
            '4h': 14400,
            '1D': 86400 
        };
        
        this.state = {};
        this.timeframes.forEach(tf => {
            this.state[tf] = {
                candles: {},
                status: {},
                fetching: {}
            };
        });

        this.MAX_CANDLES = 200; // Keep last 200 candles
        this.strategyId = null;
        this.strategyConfig = null;

        // Active Tracked Signals for Trailing SL
        this.activeSignals = new Map(); // Key: symbol_tf, Value: signalDoc
    }

    async start() {
        logger.info('🚀 Hybrid Strategy Engine Started (Multi-Timeframe Mode)');
        
        // Find or Seed the System Strategy to get its ID
        try {
            let hybrid = await Strategy.findOne({ name: 'Hybrid Strategy', isSystem: true });
            
            if (hybrid) {
                this.strategyId = hybrid._id;
                this.strategyConfig = hybrid;
                
                // Hot Reload Config
                setInterval(async () => {
                    try {
                        const fresh = await Strategy.findOne({ _id: this.strategyId });
                        if (fresh) this.strategyConfig = fresh;
                    } catch (e) { console.error('Config Reload Failed', e); }
                }, 10000); 
            }
        } catch (e) {
            logger.error('Failed to fetch Hybrid Strategy info', e);
        }

        marketDataService.on('price_update', this.handleTick.bind(this));
    }

    async handleTick(tick) {
        const { symbol, price, timestamp } = tick;
        
        // Iterate over ALL active timeframes
        for (const tf of this.timeframes) {
            this.processTimeframeTick(tf, symbol, price, timestamp);
        }
    }

    async processTimeframeTick(tf, symbol, price, timestamp) {
        const tfState = this.state[tf];
        
        // Lazy load history if missing
        if (!tfState.candles[symbol] && !tfState.fetching[symbol]) {
             await this.loadHistory(tf, symbol);
        }
        
        // Update Candle Logic
        this.updateCandle(tf, symbol, price, timestamp);
    }

    async loadHistory(tf, symbol) {
        const tfState = this.state[tf];
        if (tfState.fetching[symbol]) return;
        
        tfState.fetching[symbol] = true;
        
        try {
            // logger.debug(`📚 Pre-loading ${tf} history for ${symbol}...`);
            const seconds = this.tfMapSeconds[tf];
            const resolution = (seconds / 60).toString(); 
            
            const to = new Date();
            // Fetch enough data for 200 candles
            const from = new Date(to.getTime() - (this.MAX_CANDLES * seconds * 1000)); 
            
            const toTs = Math.floor(to.getTime() / 1000);
            const fromTs = Math.floor(from.getTime() / 1000);

            const history = await marketDataService.getHistory(
                symbol, 
                resolution, 
                fromTs, 
                toTs,
                3 // Priority 3 for background priming
            );

            if (history && history.length > 0) {
                 tfState.candles[symbol] = history.map(h => ({
                     time: h.time * 1000, 
                     open: h.open,
                     high: h.high,
                     low: h.low,
                     close: h.close
                 })).slice(-this.MAX_CANDLES);
                 
            } else {
                 tfState.candles[symbol] = []; 
            }
        } catch (e) {
            logger.error(`❌ Failed to prime ${tf} history for ${symbol}: ${e.message}`);
            tfState.candles[symbol] = [];
        } finally {
            tfState.fetching[symbol] = false;
        }
    }

    updateCandle(tf, symbol, price, timestamp) {
        const tfState = this.state[tf];
        if (!tfState.candles[symbol]) return;

        const candleSizeSec = this.tfMapSeconds[tf];
        const now = new Date(timestamp).getTime();
        const currentCandles = tfState.candles[symbol];
        const lastCandle = currentCandles[currentCandles.length - 1];

        // Align to boundary
        const candleTime = Math.floor(now / (candleSizeSec * 1000)) * (candleSizeSec * 1000);

        let isNewCandle = false;

        if (!lastCandle || lastCandle.time < candleTime) {
            // New Candle
            isNewCandle = true;
            tfState.candles[symbol].push({
                time: candleTime,
                open: price,
                high: price,
                low: price,
                close: price
            });
            
            if (tfState.candles[symbol].length > this.MAX_CANDLES) {
                tfState.candles[symbol].shift();
            }
        } else {
            // Update existing
            lastCandle.high = Math.max(lastCandle.high, price);
            lastCandle.low = Math.min(lastCandle.low, price);
            lastCandle.close = price;
        }

        // Evaluate Strategy
        this.evaluateStrategy(tf, symbol, price, isNewCandle);
        
        // --- TRAILING STOP LOSS CHECK ---
        this.handleTrailingSL(tf, symbol, price, isNewCandle);
    }

    convertToHeikinAshi(candles) {
        if (!candles || candles.length === 0) return [];
        
        const haCandles = [];
        haCandles.push({ ...candles[0] });

        for (let i = 1; i < candles.length; i++) {
            const curr = candles[i];
            const prevHa = haCandles[i - 1];

            const haOpen = (prevHa.open + prevHa.close) / 2;
            const haClose = (curr.open + curr.high + curr.low + curr.close) / 4;
            const haHigh = Math.max(curr.high, haOpen, haClose);
            const haLow = Math.min(curr.low, haOpen, haClose);

            haCandles.push({
                time: curr.time,
                open: haOpen,
                high: haHigh,
                low: haLow,
                close: haClose
            });
        }
        return haCandles;
    }

    evaluateStrategy(tf, symbol, price, isNewCandle) {
        if (!isNewCandle) return; // Only trigger on Close of previous candle / Open of new

        const tfState = this.state[tf];
        const stdCandles = tfState.candles[symbol];
        const haCandles = this.convertToHeikinAshi(stdCandles);

        if (haCandles.length < 5) return;

        // Sequence: 
        const idxCurrent = haCandles.length - 2; // Last Closed Candle
        const idxPrev = haCandles.length - 3;    // Candle before that
        const idxPrevPrev = haCandles.length - 4; // Three candles back
        
        if (idxPrevPrev < 0) return;

        const st = technicalAnalysisService.calculateSupertrend(haCandles, 14, 1.5);
        const psar = technicalAnalysisService.calculatePSAR(haCandles);
        const structure = technicalAnalysisService.calculateMarketStructure(haCandles, 5);

        // Usage Check Helper
        const isWickValid = (candle, type) => {
            const bodySize = Math.abs(candle.close - candle.open);
            const totalSize = candle.high - candle.low;
            if (totalSize === 0) return true;

            if (type === 'BUY') {
                const upperWick = candle.high - Math.max(candle.open, candle.close);
                const lowerWick = Math.min(candle.open, candle.close) - candle.low;
                const isLowerWickSmall = lowerWick <= (totalSize * 0.2); 
                return upperWick > 0 && isLowerWickSmall;
            } else {
                const lowerWick = Math.min(candle.open, candle.close) - candle.low;
                const upperWick = candle.high - Math.max(candle.open, candle.close);
                const isUpperWickSmall = upperWick <= (totalSize * 0.2);
                return lowerWick > 0 && isUpperWickSmall;
            }
        };

        const currentCandle = haCandles[idxCurrent];
        const prevCandle = haCandles[idxPrev];
        
        let signal = null;
        let entryType = ''; // 'Fast' or 'Confirmed'
        let sl = 0;
        let tp = 0;

        // --- BUY LOGIC ---
        const isTrendUpNow = st.trendArray[idxCurrent] === 1;
        const wasTrendDownPrev = st.trendArray[idxPrev] === -1;
        const wasTrendDownPrevPrev = st.trendArray[idxPrevPrev] === -1;

        // 1. Fast Entry (Entry on 2nd Candle Open - immediately after flip)
        if (isTrendUpNow && wasTrendDownPrev && price > psar.value) {
            signal = 'BUY';
            entryType = 'Fast';
        } 
        // 2. Confirmed Entry (Entry on 3rd Candle Open - original rule)
        else if (isTrendUpNow && !wasTrendDownPrev && wasTrendDownPrevPrev && price > psar.value) {
            const isConfirmGreen = currentCandle.close > currentCandle.open;
            if (isConfirmGreen && isWickValid(currentCandle, 'BUY')) {
                 if (structure.structure === 'HH_HL' || structure.structure === 'expanding') {
                     signal = 'BUY';
                     entryType = 'Confirmed';
                 }
            }
        }

        if (signal === 'BUY') {
            sl = st.value; 
            const risk = price - sl;
            tp = price + (risk * 2);
        }

        // --- SELL LOGIC ---
        if (!signal) {
            const isTrendDownNow = st.trendArray[idxCurrent] === -1;
            const wasTrendUpPrev = st.trendArray[idxPrev] === 1;
            const wasTrendUpPrevPrev = st.trendArray[idxPrevPrev] === 1;

            // 1. Fast Entry
            if (isTrendDownNow && wasTrendUpPrev && price < psar.value) {
                signal = 'SELL';
                entryType = 'Fast';
            } 
            // 2. Confirmed Entry
            else if (isTrendDownNow && !wasTrendUpPrev && wasTrendUpPrevPrev && price < psar.value) {
                const isConfirmRed = currentCandle.close < currentCandle.open;
                if (isConfirmRed && isWickValid(currentCandle, 'SELL')) {
                     if (structure.structure === 'LH_LL' || structure.structure === 'expanding') {
                         signal = 'SELL';
                         entryType = 'Confirmed';
                     }
                }
            }

            if (signal === 'SELL') {
                sl = st.value;
                const risk = sl - price;
                tp = price - (risk * 2);
            }
        }

        if (signal) {
            const risk = Math.abs(price - sl);
            const targets = {
                t1: parseFloat((signal === 'BUY' ? price + risk : price - risk).toFixed(2)),
                t2: parseFloat(tp.toFixed(2))
            };

            const notes = `Hybrid Strategy (${tf}): ${entryType} Entry (Price vs PSAR confirmed). ` + 
                         `Scaling: 5-6 candles (Partial), 10-12 candles (Full if slow).`;
            
            const metrics = { 
                notes, 
                timeframe: tf,
                entryType,
                scalingRules: {
                    partial: '5-6 candles (~30 min)',
                    full: '10-12 candles (~1 hour)'
                }
            };
            this.processSignal(tf, symbol, signal, price, sl, targets, metrics);
        }
    }

    async handleTrailingSL(tf, symbol, price, isNewCandle) {
        const key = `${symbol}_${tf}`;
        
        // 1. Check if we have an active signal cached for this TF
        let signal = this.activeSignals.get(key);
        
        // 2. If not in cache, try fetching from DB (Lazy Load)
        if (!signal) {
            signal = await Signal.findOne({ 
                symbol, 
                timeframe: tf, 
                status: 'Active',
                strategyName: 'Hybrid Strategy'
            });
            if (signal) {
                this.activeSignals.set(key, signal);
            }
        }

        if (!signal || signal.status !== 'Active') return;

        // 3. Update Stop Loss on every New Candle
        const tfState = this.state[tf];
        const haCandles = this.convertToHeikinAshi(tfState.candles[symbol]);
        if (haCandles.length < 5) return;

        const st = technicalAnalysisService.calculateSupertrend(haCandles, 14, 1.5);
        const currentST = st.value;
        const currentTrend = st.trend; // 1 for Bullish, -1 for Bearish

        let shouldUpdate = false;
        let newSL = signal.stopLoss;

        if (signal.type === 'BUY') {
            // Trend must remain Bullish
            if (currentTrend === 1 && currentST > signal.stopLoss) {
                newSL = parseFloat(currentST.toFixed(2));
                shouldUpdate = true;
            }
            // Exit if price crosses ST line (Trend Flip)
            if (currentTrend === -1 || price < currentST) {
                await this.closeSignal(signal, price, 'Trailing SL Hit (Trend Flip)');
                this.activeSignals.delete(key);
                return;
            }
        } else if (signal.type === 'SELL') {
            // Trend must remain Bearish
            if (currentTrend === -1 && currentST < signal.stopLoss) {
                newSL = parseFloat(currentST.toFixed(2));
                shouldUpdate = true;
            }
            // Exit if price crosses ST line
            if (currentTrend === 1 || price > currentST) {
                await this.closeSignal(signal, price, 'Trailing SL Hit (Trend Flip)');
                this.activeSignals.delete(key);
                return;
            }
        }

        if (shouldUpdate && isNewCandle) {
            signal.stopLoss = newSL;
            await Signal.findByIdAndUpdate(signal._id, { stopLoss: newSL });
            logger.info(`📉 [TRAILING SL] Updated ${symbol} (${tf}) SL to ${newSL}`);
            // Broadcast update via existing service logic (signalService handles this usually)
            // But we can call signalService.updateSignalById for full effect
            const { default: signalService } = await import('./signal.service.js');
            await signalService.updateSignalById(signal._id, { stopLoss: newSL });
        }
    }

    async closeSignal(signal, price, reason) {
        logger.info(`🚪 [EXIT] Closing ${signal.symbol} (${signal.timeframe}) @ ${price} - Reason: ${reason}`);
        const { default: signalService } = await import('./signal.service.js');
        await signalService.updateSignalById(signal._id, { 
            status: 'Closed',
            'report.closedPrice': price,
            'report.closedAt': new Date(),
            notes: (signal.notes || '') + `\n[Auto] ${reason} @ ${price}`
        });
    }
    
    async processSignal(tf, symbol, type, price, sl, targets, metrics) {
        if (!this.processingPending) this.processingPending = {};
        const pendingKey = `${symbol}_${tf}_${type}`; // Unique per TF
        
        if (this.processingPending[pendingKey]) return;
        this.processingPending[pendingKey] = true;
        
        const tfState = this.state[tf];
        const COOLDOWN_MS = 15 * 60 * 1000; 
        
        const lastStatus = tfState.status[symbol];

        if (lastStatus?.lastSignal && lastStatus.lastSignal.type === type) {
            const timeDiff = new Date() - new Date(lastStatus.lastSignal.timestamp);
            if (timeDiff < COOLDOWN_MS) {
                delete this.processingPending[pendingKey];
                return;
            }
        }

        try {
            // DB Deduplication with Timeframe Check
            const existing = await Signal.findOne({
                symbol: symbol,
                type: type,
                timeframe: tf, // Constraint by Timeframe
                createdAt: { $gt: new Date(Date.now() - COOLDOWN_MS) }
            });

            if (existing) {
                logger.warn(`Duplicate ${tf} signal prevented for ${symbol}`);
                if (tfState.status[symbol]) {
                    tfState.status[symbol].lastSignal = { ...existing.toObject(), timestamp: existing.createdAt };
                }
                delete this.processingPending[pendingKey];
                return;
            }

            logger.info(`🔥 HYBRID SIGNAL [${tf}]: ${type} on ${symbol} @ ${price}`);
            
            const systemUser = { id: null }; 
            
            await signalService.createSignal({
                strategyId: this.strategyId,
                strategyName: 'Hybrid Strategy',
                timeframe: tf, // Pass explicit TF
                metrics: metrics,
                symbol,
                segment: this.mapSegment(symbol),
                type,
                entryPrice: price,
                stopLoss: parseFloat(sl.toFixed(2)),
                targets: { 
                    target1: targets.t1,
                    target2: targets.t2 
                },
                notes: metrics.notes,
                status: 'Active'
            }, systemUser);
            
            if (this.strategyId) {
                await Strategy.findByIdAndUpdate(this.strategyId, {
                    $inc: { 'stats.totalSignals': 1 },
                    'stats.lastSignalAt': new Date()
                });
            }

            // Update Memory Status
            if (!this.state[tf].status[symbol]) this.state[tf].status[symbol] = {};
            this.state[tf].status[symbol].lastSignal = { 
                type, timestamp: new Date() 
            };

        } catch (e) {
            logger.error(`Error persisting signal for ${symbol}`, e);
        } finally {
            delete this.processingPending[pendingKey];
        }
    }

    mapSegment(symbol) {
        if (!symbol.includes(':')) return 'EQUITY';
        const [exchange, sym] = symbol.split(':');
        const map = {
            'NSE': 'FNO', 'BSE': 'EQUITY', 'MCX': 'COMMODITY',
            'CDS': 'CURRENCY', 'BINANCE': 'CRYPTO', 'BITSTAMP': 'CRYPTO'
        };
        if (exchange === 'NSE' && sym.endsWith('-EQ')) return 'EQUITY';
        return map[exchange] || 'EQUITY';
    }

    getLiveStatus(symbol) {
        // Return aggregation of all TFs
        const result = {};
        this.timeframes.forEach(tf => {
            result[tf] = this.state[tf].status[symbol] || {};
        });
        return result;
    }
}

export const hybridStrategyService = new HybridStrategyService();
export default hybridStrategyService;

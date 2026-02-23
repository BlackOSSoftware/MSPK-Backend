import { SMA } from 'technicalindicators';

class TechnicalAnalysisService {
    
    /**
     * Custom Supertrend Calculation matching Pine Script
     * @param {Array} candles - Array of { high, low, close }
     * @param {Number} period - ATR Period (default 10)
     * @param {Number} multiplier - ATR Multiplier (default 3.0)
     * @returns {Object} { value, trend: 1 (Up) | -1 (Down) }
     */
    calculateSupertrend(candles, period = 10, multiplier = 3.0) {
        if (!candles || candles.length < period + 1) return { value: 0, trend: 0 };

        // 1. Calculate TR (True Range)
        const trs = [];
        for (let i = 0; i < candles.length; i++) {
            if (i === 0) {
                trs.push(candles[i].high - candles[i].low);
                continue;
            }
            const high = candles[i].high;
            const low = candles[i].low;
            const prevClose = candles[i - 1].close;
            
            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );
            trs.push(tr);
        }

        // 2. Calculate ATR (SMA of TR)
        // input: atr2 = sma(tr, Periods)
        // input: atr = changeATR ? atr(Periods) : atr2
        // Assuming we use SMA as per the script's default "atr2" if changeATR is false.
        // But Pine's `atr()` function is usually RMA (Wilder's MA).
        // The script says: atr2 = sma(tr, Periods). atr = changeATR ? atr(Periods) : atr2.
        // If changeATR is true (default), it uses built-in atr() which is RMA.
        // We will implement RMA (Wilder's Smoothing) for better accuracy with default Pine behavior.

        let atr = [];
        // First ATR is SMA
        let sumTR = 0;
        for(let i=0; i<period; i++) sumTR += trs[i];
        atr[period-1] = sumTR / period;

        // Subsequent are RMA: (prevATR * (n-1) + currentTR) / n
        for(let i=period; i<candles.length; i++) {
            atr[i] = (atr[i-1] * (period - 1) + trs[i]) / period;
        }

        // 3. Calculate Supertrend
        // up=src-(Multiplier*atr)
        // dn=src+(Multiplier*atr)
        // We calculate for the whole series to establish trend continuity
        
        let up = new Array(candles.length).fill(0);
        let dn = new Array(candles.length).fill(0);
        let trend = new Array(candles.length).fill(1); // 1 = Up, -1 = Down

        for (let i = period; i < candles.length; i++) {
            const src = (candles[i].high + candles[i].low) / 2; // hl2
            const currentATR = atr[i];
            
            let currentUp = src - (multiplier * currentATR);
            let currentDn = src + (multiplier * currentATR);

            // prevUp = nz(up[1], up)
            // up := close[1] > up1 ? max(up, up1) : up
            const prevUp = up[i-1] || currentUp;
            const prevClose = candles[i-1].close;
            
            if (prevClose > prevUp) {
                currentUp = Math.max(currentUp, prevUp);
            }
            up[i] = currentUp;

            // prevDn = nz(dn[1], dn)
            // dn := close[1] < dn1 ? min(dn, dn1) : dn
            const prevDn = dn[i-1] || currentDn;
            if (prevClose < prevDn) {
                currentDn = Math.min(currentDn, prevDn);
            }
            dn[i] = currentDn;

            // Trend Logic
            // trend := nz(trend[1], trend)
            // trend := trend == -1 and close > dn1 ? 1 : trend == 1 and close < up1 ? -1 : trend
            let currentTrend = trend[i-1] || 1;
            const close = candles[i].close;

            if (currentTrend === -1 && close > prevDn) {
                currentTrend = 1;
            } else if (currentTrend === 1 && close < prevUp) {
                currentTrend = -1;
            }
            trend[i] = currentTrend;
        }

        const lastIndex = candles.length - 1;
        return {
            value: trend[lastIndex] === 1 ? up[lastIndex] : dn[lastIndex],
            trend: trend[lastIndex],
            trendArray: trend, // Expose full history for flip checks
            isBuy: trend[lastIndex] === 1 && trend[lastIndex-1] === -1,
            isSell: trend[lastIndex] === -1 && trend[lastIndex-1] === 1
        };
    }

    calculatePSAR(candles, step = 0.02, max = 0.2) {
        // Simple implementation or use library. 
        // For accurate "reversal" logic matching Pine, manual might be safest, 
        // but library `technicalindicators` has PSAR.
        // Let's use a simplified custom loop to ensure start/reverse logic matches description.
        
        if (!candles || candles.length < 2) return { value: 0, trend: 'up' };

        // Initial Setup
        let isUp = candles[1].close > candles[0].close;
        let sar = isUp ? candles[0].low : candles[0].high;
        let ep = isUp ? candles[0].high : candles[0].low; // Extreme Point
        let af = step; // Acceleration Factor

        for (let i = 1; i < candles.length; i++) {
            const prevSar = sar;
            
            // Calculate today's SAR
            // SAR = PrevSAR + AF * (PrevEP - PrevSAR)
            sar = prevSar + af * (ep - prevSar);

            // Boundary checks
            const prevLow = candles[i-1].low;
            const prevPrevLow = i > 1 ? candles[i-2].low : prevLow;
            const prevHigh = candles[i-1].high;
            const prevPrevHigh = i > 1 ? candles[i-2].high : prevHigh;

            if (isUp) {
                // If uptrend, SAR cannot be above previous two lows
                sar = Math.min(sar, prevLow, prevPrevLow);
                
                // Check if price penetrates SAR
                if (candles[i].low < sar) {
                    // Reversal to Down
                    isUp = false;
                    sar = ep; // New SAR is old EP
                    ep = candles[i].low; // Reset EP
                    af = step; // Reset AF
                } else {
                    // Continue Uptrend
                    if (candles[i].high > ep) {
                        ep = candles[i].high;
                        af = Math.min(af + step, max);
                    }
                }
            } else {
                // If downtrend, SAR cannot be below previous two highs
                sar = Math.max(sar, prevHigh, prevPrevHigh); // Logic seems inverted in many docs, but standard is: prevent SAR form crossing price "backwards"
                
                // Check if price penetrates SAR
                if (candles[i].high > sar) {
                    // Reversal to Up
                    isUp = true;
                    sar = ep; 
                    ep = candles[i].high;
                    af = step;
                } else {
                    // Continue Downtrend
                    if (candles[i].low < ep) {
                        ep = candles[i].low;
                        af = Math.min(af + step, max);
                    }
                }
            }
        }
        
        return {
            value: sar,
            trend: isUp ? 'up' : 'down'
        };
    }

    /**
     * Identify Higher Highs / Lower Lows (ZigZag-like)
     * @param {Array} candles 
     * @param {Number} depth - Lookback period for pivot
     */
    calculateMarketStructure(candles, depth = 5) {
        if (!candles || candles.length < depth * 2) return { structure: 'consolidation', lastPivot: 'none' };

        // Find pivots
        let pivots = [];
        // Pivot High: High[i] > High[i +/- 1...depth]
        // We scan backwards
        
        const isPivotHigh = (idx) => {
            const h = candles[idx].high;
            for(let j=1; j<=depth; j++) {
                if(idx-j < 0 || candles[idx-j].high > h) return false;
                if(idx+j >= candles.length || candles[idx+j].high > h) return false;
            }
            return true;
        };

        const isPivotLow = (idx) => {
            const l = candles[idx].low;
            for(let j=1; j<=depth; j++) {
                if(idx-j < 0 || candles[idx-j].low < l) return false;
                if(idx+j >= candles.length || candles[idx+j].low < l) return false;
            }
            return true;
        };

        for(let i=depth; i < candles.length - depth; i++) {
            if(isPivotHigh(i)) pivots.push({ type: 'PH', price: candles[i].high, index: i });
            if(isPivotLow(i)) pivots.push({ type: 'PL', price: candles[i].low, index: i });
        }

        // Analyze last 2 identical pivots to determine structure trend
        const highs = pivots.filter(p => p.type === 'PH');
        const lows = pivots.filter(p => p.type === 'PL');

        if(highs.length < 2 || lows.length < 2) return { structure: 'insufficient_data', lastPivot: null };

        const lastPH = highs[highs.length - 1];
        const prevPH = highs[highs.length - 2];
        const lastPL = lows[lows.length - 1];
        const prevPL = lows[lows.length - 2];

        let structure = 'neutral';
        if (lastPH.price > prevPH.price && lastPL.price > prevPL.price) structure = 'HH_HL'; // Uptrend
        else if (lastPH.price < prevPH.price && lastPL.price < prevPL.price) structure = 'LH_LL'; // Downtrend
        else if (lastPH.price > prevPH.price && lastPL.price < prevPL.price) structure = 'expanding';
        else if (lastPH.price < prevPH.price && lastPL.price > prevPL.price) structure = 'consolidation';

        return {
            structure,
            lastPivot: pivots[pivots.length - 1]
        };
    }

    /**
     * Hybrid Analysis Logic (HA + Supertrend + PSAR + Structure)
     * @param {Array} candles 
     * @param {String} timeframeName 
     */
    analyzeTimeframe(candles, timeframeName) {
        if (!candles || candles.length < 20) return { trend: 'NEUTRAL', signal: 'NONE', age: 0, price: 0 };

        // Convert to Heikin Ashi
        const haCandles = [];
        haCandles.push({ ...candles[0] });
        for (let i = 1; i < candles.length; i++) {
            const curr = candles[i];
            const prevHa = haCandles[i - 1];
            const haOpen = (prevHa.open + prevHa.close) / 2;
            const haClose = (curr.open + curr.high + curr.low + curr.close) / 4;
            haCandles.push({
                time: curr.time,
                open: haOpen, high: Math.max(curr.high, haOpen, haClose),
                low: Math.min(curr.low, haOpen, haClose), close: haClose
            });
        }

        // Indicators
        const st = this.calculateSupertrend(haCandles, 14, 1.5);
        const psar = this.calculatePSAR(haCandles);
        const structure = this.calculateMarketStructure(haCandles, 5);
        
        const lastCandle = candles[candles.length - 1];
        const currentPrice = lastCandle.close;

        const trend = st.trend === 1 ? 'BULLISH' : 'BEARISH';
        
        let signalType = 'HOLD'; 
        if (st.isBuy) signalType = 'BUY';
        if (st.isSell) signalType = 'SELL';
        
        let isStrong = false;
        if (trend === 'BULLISH' && psar.value < currentPrice && structure.structure === 'HH_HL') isStrong = true;
        if (trend === 'BEARISH' && psar.value > currentPrice && structure.structure === 'LH_LL') isStrong = true;

        return {
            timeframe: timeframeName,
            trend,
            signalType,
            price: currentPrice,
            support: st.trend === 1 ? st.value : psar.value,
            resistance: st.trend === -1 ? st.value : psar.value,
            isStrong
        };
    }

    calculateRSI(candles, period = 14) {
        if (!candles || candles.length < period + 1) return 50;

        let gains = 0;
        let losses = 0;

        for (let i = 1; i <= period; i++) {
            const diff = candles[i].close - candles[i - 1].close;
            if (diff >= 0) gains += diff;
            else losses -= diff;
        }

        let avgGain = gains / period;
        let avgLoss = losses / period;

        for (let i = period + 1; i < candles.length; i++) {
            const diff = candles[i].close - candles[i - 1].close;
            const currentGain = diff >= 0 ? diff : 0;
            const currentLoss = diff < 0 ? -diff : 0;

            avgGain = (avgGain * (period - 1) + currentGain) / period;
            avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
        }

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }
}

export const technicalAnalysisService = new TechnicalAnalysisService();
export default technicalAnalysisService;

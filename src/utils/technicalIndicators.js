/**
 * Calculate RSI (Relative Strength Index)
 * @param {Array<number>} closes - Array of closing prices (newest last)
 * @param {number} period - RSI Period (default 14)
 * @returns {number} RSI Value (0-100)
 */
export const calculateRSI = (closes, period = 14) => {
    if (!closes || closes.length < period + 1) return 50; // Not enough data, return neutral

    let gains = 0;
    let losses = 0;

    // Calculate initial average
    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Smooth subsequent values
    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        let gain = change > 0 ? change : 0;
        let loss = change < 0 ? Math.abs(change) : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
};

/**
 * Get Fear & Greed Label from RSI
 */
export const getFearGreedFromRSI = (rsi) => {
    if (rsi >= 80) return { label: "Extreme Greed", score: Math.round(rsi) };
    if (rsi >= 60) return { label: "Greed", score: Math.round(rsi) };
    if (rsi <= 20) return { label: "Extreme Fear", score: Math.round(rsi) };
    if (rsi <= 40) return { label: "Fear", score: Math.round(rsi) };
    return { label: "Neutral", score: Math.round(rsi) };
};

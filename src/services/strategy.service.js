import Strategy from '../models/Strategy.js';
import Signal from '../models/Signal.js';
import marketDataService from './marketData.service.js';
import signalService from './signal.service.js';
import logger from '../config/logger.js';
import User from '../models/User.js';

// In-Memory Strategy Cache (For Microsecond Access)
let activeStrategies = [];
let isEngineRunning = false;
const processingPending = new Map(); // Global pending guard

const startEngine = async () => {
    if (isEngineRunning) return;
    
    logger.info('🚀 Strategy Engine Starting (Event-Driven Mode)...');
    isEngineRunning = true;
    
    // 1. Initial Cache Load
    await refreshCache();

    // 2. Subscribe to Market Data Events (Push Architecture)
    marketDataService.on('price_update', handlePriceUpdate);
};

const stopEngine = () => {
    if (!isEngineRunning) return;
    
    logger.info('🛑 Strategy Engine Stopped.');
    isEngineRunning = false;
    
    // Unsubscribe
    marketDataService.off('price_update', handlePriceUpdate);
    activeStrategies = [];
};

// Refresh Cache (Called on Start and when User updates Strategy)
const refreshCache = async () => {
    try {
        const strategies = await Strategy.find({ status: 'Active' });
        activeStrategies = strategies;
        logger.info(`♻️ Strategy Cache Refreshed. Loaded ${strategies.length} active bots.`);
    } catch (e) {
        logger.error('Failed to refresh strategy cache', e);
    }
};

// Event Handler: Called instantly on every tick
const handlePriceUpdate = async (tick) => {
    if (!isEngineRunning) return;

    // Filter strategies interested in this symbol
    const relevantStrategies = activeStrategies.filter(s => s.symbol === tick.symbol);
    
    for (const strategy of relevantStrategies) {
        const isMatch = evaluateLogic(strategy.logic, tick);
        
        if (isMatch) {
            await triggerSignal(strategy, tick);
        }
    }
};

// Evaluation Logic
const evaluateLogic = (logic, tick) => {
    const rule = logic?.rules?.[0];
    if (!rule) return false;

    // --- PROTECTIVE FILTER ---
    // The basic engine only supports simple Price vs Value comparisons.
    // Advanced indicators like Supertrend/PSAR are handled by HybridStrategyService.
    const advancedIndicators = ['Supertrend', 'PSAR', 'RSI', 'EMA', 'SMA'];
    if (advancedIndicators.includes(rule.indicator)) {
        return false; 
    }

    const currentPrice = tick.price;
    const threshold = rule.value; 

    if (rule.operator === '>') return currentPrice > threshold;
    if (rule.operator === '<') return currentPrice < threshold;
    if (rule.operator === '>=') return currentPrice >= threshold;
    if (rule.operator === '<=') return currentPrice <= threshold;
    if (rule.operator === 'CROSS_ABOVE') return currentPrice > threshold; // Simple fallback
    if (rule.operator === 'CROSS_BELOW') return currentPrice < threshold;
    
    return false;
};

const triggerSignal = async (strategy, tick) => {
    // 1. Pending Guard
    const pendingKey = `${strategy._id.toString()}_${tick.symbol}`;
    if (processingPending.has(pendingKey)) return;

    // 2. Cooldown Validation
    const cooldownMs = 30 * 1000;
    const now = new Date();
    
    if (strategy.stats?.lastSignalAt) {
        const diff = now - new Date(strategy.stats.lastSignalAt);
        if (diff < cooldownMs) return;
    }

    // Set Pending & Update Local Cooldown IMMEDIATELY
    processingPending.set(pendingKey, true);
    if (strategy.stats) strategy.stats.lastSignalAt = now;

    logger.info(`⚡ SIGNAL: ${strategy.name} triggered on ${tick.symbol} @ ${tick.price}`);

    const signalData = {
        strategyId: strategy._id,
        strategyName: strategy.name,
        timeframe: strategy.timeframe,
        symbol: strategy.symbol,
        segment: strategy.segment,
        type: strategy.action === 'BUY' ? 'BUY' : 'SELL',
        entryPrice: tick.price,
        stopLoss: parseFloat((tick.price * 0.98).toFixed(2)),
        targets: {
            target1: parseFloat((tick.price * 1.02).toFixed(2)),
            target2: parseFloat((tick.price * 1.04).toFixed(2)),
            target3: parseFloat((tick.price * 1.06).toFixed(2))
        },
        notes: `🤖 Bot Signal: ${strategy.name}`,
        isFree: false
    };

    const systemUser = { id: strategy.user, role: 'admin' }; 
    
    try {
        await signalService.createSignal(signalData, systemUser);
        
        // Update Stats in DB (Async, don't block engine)
        // Note: In high-scale system, we'd queue this update too.
        await Strategy.findByIdAndUpdate(strategy._id, {
            $inc: { 'stats.totalSignals': 1 },
            'stats.lastSignalAt': new Date()
        });

        // Update local cache to reflect cooldown immediately
        const cachedStrat = activeStrategies.find(s => s._id.toString() === strategy._id.toString());
        if (cachedStrat) {
            if (!cachedStrat.stats) cachedStrat.stats = {};
            cachedStrat.stats.lastSignalAt = new Date();
        }

    } catch (e) {
        logger.error('Failed to process signal', e);
    } finally {
        processingPending.delete(pendingKey);
    }
};

// Export refreshCache too so Controllers can call it on update
export const reloadStrategies = refreshCache;

const seedStrategies = async (user = null) => {
    const hybrid = await Strategy.findOne({ name: 'Hybrid Strategy', isSystem: true });
    if (!hybrid) {
         let userId = user?.id;
         if (!userId) {
             const admin = await User.findOne({ role: 'admin' });
             userId = admin?._id;
         }

         if (userId) {
            await Strategy.create({
                user: userId,
                name: 'Hybrid Strategy',
                symbol: 'NSE:NIFTYBANK-INDEX',
                timeframe: '5m',
                segment: 'FNO',
                status: 'Active',
                isSystem: true,
                isDefault: true,
                logic: {
                    condition: 'AND',
                    rules: [
                        { indicator: 'Supertrend', params: { period: 10, multiplier: 3 }, operator: 'CROSS_ABOVE', value: 0 },
                        { indicator: 'PSAR', params: { step: 0.02, max: 0.2 }, operator: '<', value: 'CLOSE' }
                    ]
                }
            });
            logger.info('✅ Hybrid Strategy seeded successfully');
         } else {
             logger.warn('⚠️ Could not find an admin user to assign Hybrid Strategy');
         }
    }
    return { success: true };
};

export default {
    startEngine,
    stopEngine,
    reloadStrategies: refreshCache,
    seedStrategies
};

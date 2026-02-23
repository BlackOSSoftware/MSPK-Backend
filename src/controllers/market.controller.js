import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import MasterSegment from '../models/MasterSegment.js';
import MasterSymbol from '../models/MasterSymbol.js';
import config from '../config/config.js';
import logger from '../config/logger.js';

// Seed Data (Standard Set)
import marketDataService from '../services/marketData.service.js';
import { kiteService } from '../services/kite.service.js';
import subscriptionService from '../services/subscription.service.js';
import { technicalAnalysisService } from '../services/index.js';
import fmpService from '../services/fmp.service.js';



// Get Subscription-Based Tickers (Watchlist)
const getTickers = catchAsync(async (req, res) => {
    // Default to Restricted/Empty if no user (or return Nifty 50 as safe default)
    let allowedSegments = ['INDICES']; 
    let allowedExchanges = ['NSE']; // Minimal default

    if (req.user) {
        try {
            const { default: authService } = await import('../services/auth.service.js');
            const planData = await authService.getUserActivePlan(req.user);

            if (planData && planData.permissions.length > 0) {
                 const perms = planData.permissions;
                 allowedSegments = []; 
                 allowedExchanges = [];

                 if (perms.includes('COMMODITY') || perms.includes('MCX_FUT')) {
                    allowedSegments.push('COMMODITY');
                    allowedExchanges.push('MCX');
                 }
                 if (perms.includes('EQUITY_INTRA') || perms.includes('EQUITY_DELIVERY')) {
                    allowedSegments.push('EQUITY', 'INDICES');
                    allowedExchanges.push('NSE', 'BSE');
                 }
                 if (perms.includes('NIFTY_OPT') || perms.includes('BANKNIFTY_OPT')) {
                    allowedSegments.push('FNO', 'INDICES');
                    allowedExchanges.push('NFO', 'MCX', 'CDS');
                 }
                 if (perms.includes('CURRENCY')) {
                    allowedSegments.push('CURRENCY');
                    allowedExchanges.push('CDS', 'FOREX');
                 }
                 if (perms.includes('CRYPTO')) {
                    allowedSegments.push('CRYPTO');
                    allowedExchanges.push('BINANCE', 'CRYPTO');
                 }
            }
        } catch (e) {
            logger.error(`Error in getTickers filter: ${e.message}`);
        }
    }

    // Filter allowed symbols
    const query = { 
        isWatchlist: true,
        $or: [
            { segment: { $in: allowedSegments } },
            { exchange: { $in: allowedExchanges } }
        ]
    };

    // If no allowed segments found (e.g. invalid user), query fails safe (empty OR default Nifty)
    if (allowedSegments.length === 0 && allowedExchanges.length === 0) {
        // Fallback: Show Nifty 50 only
        query.$or = [{ symbol: 'NSE:NIFTY 50-INDEX' }];
    }

    const symbols = await MasterSymbol.find(query).sort({ segment: 1, symbol: 1 }).lean();

    // Inject Real-Time Prices
    const enriched = symbols.map(s => {
        const live = marketDataService.currentPrices[s.symbol] || s.lastPrice || 0;
        const ohlc = marketDataService.currentQuotes[s.symbol]?.ohlc;
        const prevClose = ohlc ? ohlc.close : (s.prevClose || live); 
        
        let change = 0;
        if (prevClose > 0 && live > 0) {
            change = ((live - prevClose) / prevClose) * 100;
        }

        return {
            symbol: s.symbol,
            name: s.name,
            segment: s.segment,
            exchange: s.exchange,
            price: live,
            prevClose: parseFloat(prevClose.toFixed(2)),
            change: parseFloat(change.toFixed(2)),
            isUp: change >= 0,
            lotSize: s.lotSize || 1,
            // Add color hint?
            color: change >= 0 ? '#22C55E' : '#EF4444'
        };
    });

    res.send(enriched);
});

import { calculateRSI, getFearGreedFromRSI } from '../utils/technicalIndicators.js'; // Import Utility

// Get Market Sentiment (Real-Time RSI + VIX)
const getSentiment = catchAsync(async (req, res) => {
    let context = "INDIAN"; // Default
    let symbol = "NSE:NIFTY 50-INDEX"; 
    let marketLabel = "Market Mood";
    let secondarySymbol = "NSE:NIFTY BANK-INDEX";
    let secondaryName = "BankNifty";

    // Determine User Context
    if (req.user) {
        try {
            const { default: authService } = await import('../services/auth.service.js');
            const planData = await authService.getUserActivePlan(req.user);
            
            if (planData && planData.permissions.length > 0) {
                const perms = planData.permissions;
                
                // Segment Priority Logic
                if (perms.includes('CRYPTO')) {
                    context = "CRYPTO";
                    symbol = "BTCUSDT"; // AllTick/Global
                    marketLabel = "Crypto Mood";
                    secondarySymbol = "ETHUSDT";
                    secondaryName = "ETH";
                } else if (perms.includes('COMMODITY') || perms.includes('MCX_FUT')) {
                    // Check if strictly Global Commodity or Indian MCX
                    // Usually users want Gold/Silver global sentiment
                    context = "COMMODITY";
                    symbol = "XAUUSD"; // Gold
                    marketLabel = "Gold Sentiment";
                    secondarySymbol = "XAGUSD";
                    secondaryName = "Silver";
                } else if (perms.includes('CURRENCY')) {
                    context = "FOREX";
                    symbol = "EURUSD";
                    marketLabel = "Forex Sentiment";
                    secondarySymbol = "GBPUSD";
                    secondaryName = "GBP/USD";
                } else {
                    // Default Indian Equity/FNO
                    context = "INDIAN";
                    symbol = "NSE:NIFTY 50-INDEX";
                    marketLabel = "Nifty Mood";
                    secondarySymbol = "NSE:NIFTY BANK-INDEX";
                    secondaryName = "BankNifty";
                }
            }
        } catch (err) {
            logger.error(`Error in getSentiment filter: ${err.message}`);
        }
    }

    // 2. Market Mood Calculation
    let rsiValue = null; 
    let fearGreedScore = 50; // Default Neutral
    let sentimentLabel = "Neutral";
    let sentimentTrend = "Neutral"; // Default
    let hasData = false;

    // A. Calculate RSI (Common for all)
    try {
        const to = Math.floor(Date.now() / 1000);
        const from = to - (60 * 24 * 60 * 60); // 60 Days
        const candles = await marketDataService.getHistory(symbol, 'day', from, to);
        let closes = (candles || []).map(c => c.close);
        
        // Append live price
        const currentPrice = marketDataService.currentPrices[symbol];
        if (currentPrice && currentPrice > 0) closes.push(currentPrice);

        if (closes.length > 14) {
            rsiValue = calculateRSI(closes, 14);
            hasData = true;
        }
    } catch (e) {
        logger.error(`Error calculating RSI for ${symbol}: ${e.message}`);
    }

    // B. Context Specific Adjustments
    if (context === "INDIAN") {
        // Indian Market: Use INDIA VIX if available
        const vixPrice = marketDataService.currentPrices['NSE:INDIA VIX'] || 
                         marketDataService.currentPrices['INDIA VIX'] || 0;
        
        // If we have RSI, start with that. If not, start with 50.
        fearGreedScore = rsiValue ?? 50; 

        // Adjust with VIX (Volatility Index)
        if (vixPrice > 0) {
            let vixImpact = 0;
            if (vixPrice > 22) vixImpact = -20; // High Fear
            else if (vixPrice > 16) vixImpact = -10; // Moderate Fear
            else if (vixPrice < 12) vixImpact = +10; // Greed/Confidence
            
            fearGreedScore += vixImpact;
            hasData = true; // We have at least VIX data
        }

        // Clamp
        fearGreedScore = Math.max(0, Math.min(100, fearGreedScore));

        // Generate Label
        if (!hasData) {
            sentimentLabel = "No Data";
            fearGreedScore = null;
        } else {
            if (fearGreedScore >= 80) sentimentLabel = "Extreme Greed";
            else if (fearGreedScore >= 60) sentimentLabel = "Greed";
            else if (fearGreedScore <= 20) sentimentLabel = "Extreme Fear";
            else if (fearGreedScore <= 40) sentimentLabel = "Fear";
            else sentimentLabel = "Neutral";
        }

        sentimentTrend = (fearGreedScore !== null && fearGreedScore >= 50) ? "Bullish" : "Bearish";

    } else {
        // Foreign (Crypto/Forex): Pure RSI based
        if (rsiValue !== null) {
            const rsiResult = getFearGreedFromRSI(rsiValue);
            fearGreedScore = rsiResult.score;
            sentimentLabel = rsiResult.label;
            sentimentTrend = (rsiValue > 50) ? "Bullish" : "Bearish";
        } else {
            sentimentLabel = "No Data";
            fearGreedScore = null;
        }
    }

    // 3. Market Trend Data (Percentage Change)
    const getTrend = (sym) => {
        const live = marketDataService.currentPrices[sym] || 0;
        const quote = marketDataService.currentQuotes[sym];
        const open = quote?.ohlc?.open || live;
        
        if (live === 0 || open === 0) return { direction: null, change: null, hasData: false };
        
        const change = ((live - open) / open) * 100;
        return {
            direction: change >= 0 ? 'Bullish' : 'Bearish',
            change: parseFloat(change.toFixed(2)),
            hasData: true
        };
    };

    // Return context-aware trend
    // secondarySymbol and secondaryName are already set based on user context at the top
    // No need to re-declare them here.

    const sentiment = {
        fearGreed: {
            score: fearGreedScore !== null ? parseFloat(fearGreedScore.toFixed(0)) : null,
            label: sentimentLabel,
            trend: sentimentTrend,
            context: marketLabel,
            symbol: symbol
        },
        marketTrend: {
            primary: {
                name: symbol === "NSE:NIFTY 50-INDEX" ? "Nifty" : (symbol === "BTCUSDT" ? "BTC" : (symbol === "XAUUSD" ? "Gold" : symbol)),
                ...getTrend(symbol)
            },
            secondary: {
                name: secondaryName,
                ...getTrend(secondarySymbol)
            }
        }
    };
    
    res.send(sentiment);
});

// Get Hybrid Analysis for ANY Symbol
const getSymbolAnalysis = catchAsync(async (req, res) => {
    let { symbol } = req.params;
    if (!symbol) {
        throw new Error('Symbol is required');
    }
    symbol = symbol.toUpperCase();

    // 1. Fetch Candles Parallel (5m, 15m, 1H, 1D)
    // Use marketDataService.getHistory to handle Kite/AllTick automatically
    const now = Math.floor(Date.now() / 1000);
    const from = now - (5 * 24 * 60 * 60); // 5 Days back

    const [c5m, c15m, c1H, c1D] = await Promise.all([
        marketDataService.getHistory(symbol, '5', from.toString(), now.toString()),
        marketDataService.getHistory(symbol, '15', from.toString(), now.toString()),
        marketDataService.getHistory(symbol, '60', from.toString(), now.toString()),
        marketDataService.getHistory(symbol, 'D', from.toString(), now.toString()),
    ]);

    const analysis = {
        scan_5m: technicalAnalysisService.analyzeTimeframe(c5m, '5m'),
        scan_15m: technicalAnalysisService.analyzeTimeframe(c15m, '15m'),
        scan_1h: technicalAnalysisService.analyzeTimeframe(c1H, '1H'),
    };

    // 2. Calculate Daily Volatility Levels
    let volatility = {};
    if (c1D && c1D.length > 14) {
        // Calculate ATR 14
        let sumTR = 0;
        for(let i=c1D.length-14; i<c1D.length; i++) {
             const h = c1D[i].high; const l = c1D[i].low; const pc = c1D[i-1].close;
             sumTR += Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc));
        }
        const atr = sumTR / 14;
        const currentPrice = c1D[c1D.length-1].close;
        
        volatility = {
            atr: atr,
            expectedHigh: currentPrice + atr,
            expectedLow: currentPrice - atr,
            buyPrice: currentPrice + (atr * 0.2), 
            sellPrice: currentPrice - (atr * 0.2)
        };
    }

    res.send({
        symbol,
        analysis,
        volatility,
        timestamp: new Date()
    });
});

const getNews = catchAsync(async (req, res) => {
    let { symbol } = req.params;
    // Optional: Validate symbol or handle special cases?
    // FmpService handles formatting.
    const news = await fmpService.getNews(symbol);
    res.send(news);
});

const SEED_SEGMENTS = [
    { name: 'Equity Intraday', code: 'EQUITY' },
    { name: 'Futures & Options', code: 'FNO' },
    { name: 'Commodity', code: 'COMMODITY' },
    { name: 'Currency', code: 'CURRENCY' },
    { name: 'BTST (Buy Today Sell Tomorrow)', code: 'BTST' }
];

const SEED_SYMBOLS = [];

const seedMarketData = catchAsync(async (req, res) => {
    // 1. Seed Segments
    const segCount = await MasterSegment.countDocuments();
    if (segCount === 0) {
        await MasterSegment.insertMany(SEED_SEGMENTS);
    }

    // 2. Seed Symbols
    const symCount = await MasterSymbol.countDocuments();
    if (symCount === 0) {
        await MasterSymbol.insertMany(SEED_SYMBOLS);
    }

    res.status(httpStatus.CREATED).send({ message: 'Market Master Data Seeded Successfully' });
});

const createSegment = catchAsync(async (req, res) => {
    const { name, code } = req.body;
    const segment = await MasterSegment.create({ name, code });
    res.status(httpStatus.CREATED).send(segment);
});

const updateSegment = catchAsync(async (req, res) => {
    const { id } = req.params;
    const segment = await MasterSegment.findByIdAndUpdate(id, req.body, { new: true });
    res.send(segment);
});

import kiteInstrumentsService from '../services/kiteInstruments.service.js';

const createSymbol = catchAsync(async (req, res) => {
    // Auto-populate instrumentToken from Kite Instruments Memory
    if (!req.body.instrumentToken && req.body.symbol) {
        const sym = req.body.symbol.toUpperCase();
        
        // Auto-detect Crypto
        if (sym.includes('USDT')) {
            req.body.segment = 'CRYPTO';
            req.body.exchange = 'BINANCE';
        }

        const instrument = kiteInstrumentsService.getInstrumentBySymbol(req.body.symbol);
        if (instrument) {
            req.body.instrumentToken = String(instrument.instrument_token);
        } else {
             // Try removing -EQ suffix for NSE
             if (req.body.symbol.endsWith('-EQ')) {
                 const raw = req.body.symbol.replace('-EQ', '');
                 const inst2 = kiteInstrumentsService.getInstrumentBySymbol(raw);
                 if (inst2) req.body.instrumentToken = String(inst2.instrument_token);
             }
        }
    }

    const symbol = await MasterSymbol.create(req.body);
    
    // Real-time update: Add to running memory and subscribe
    await marketDataService.addSymbol(symbol);

    res.status(httpStatus.CREATED).send(symbol);
});

const updateSymbol = catchAsync(async (req, res) => {
    const { id } = req.params;
    const symbol = await MasterSymbol.findByIdAndUpdate(id, req.body, { new: true });
    res.send(symbol);
});

const getSegments = catchAsync(async (req, res) => {
    const segments = await MasterSegment.find(); // Return all, let frontend filter active if needed or admin sees all
    res.send(segments);
});

const getSymbols = catchAsync(async (req, res) => {
    const { segment, watchlist } = req.query;
    const filter = {};
    if (segment) filter.segment = segment;
    if (watchlist === 'true') filter.isWatchlist = true;
    
    // Sort by symbol name
    // Use .lean() to get plain objects we can modify
    const symbols = await MasterSymbol.find(filter).sort({ symbol: 1 }).lean();
    
    // Inject current price from memory
        const enrichedSymbols = symbols.map(s => {
            s.lastPrice = marketDataService.currentPrices[s.symbol] || s.lastPrice || 0;
            s.ltp = s.lastPrice; // Alias
            
            // Inject OHLC if available (from fetchInitialQuote)
            if (marketDataService.currentQuotes && marketDataService.currentQuotes[s.symbol]) {
                 s.ohlc = marketDataService.currentQuotes[s.symbol].ohlc;
            }
            
            return s;
        });

    res.send(enrichedSymbols);
});

import Signal from '../models/Signal.js'; // Import Signal Model


const deleteSegment = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    // 1. Find the segment first
    const segment = await MasterSegment.findById(id);
    if (!segment) {
        return res.status(httpStatus.NOT_FOUND).send({ message: 'Segment not found' });
    }

    // 2. Check dependencies (Symbols)
    const symbolCount = await MasterSymbol.countDocuments({ segment: segment.code });
    if (symbolCount > 0) {
        return res.status(httpStatus.BAD_REQUEST).send({ 
            message: `Cannot delete. ${symbolCount} symbols are linked to this segment.` 
        });
    }

    // 3. Check dependencies (Signals)
    const signalCount = await Signal.countDocuments({ segment: segment.code });
    if (signalCount > 0) {
        return res.status(httpStatus.BAD_REQUEST).send({ 
            message: `Cannot delete. ${signalCount} active signals are linked to this segment.` 
        });
    }

    // 4. Safe to delete
    await MasterSegment.findByIdAndDelete(id);
    res.status(httpStatus.NO_CONTENT).send();
});

const deleteSymbol = catchAsync(async (req, res) => {
    const { id } = req.params;

    // 1. Find the symbol
    const symbol = await MasterSymbol.findById(id);
    if (!symbol) {
         return res.status(httpStatus.NOT_FOUND).send({ message: 'Symbol not found' });
    }

    // 2. Check dependencies (Signals)
    // We check if any Signal uses this symbol directly (by string name)
    const signalCount = await Signal.countDocuments({ symbol: symbol.symbol });
    if (signalCount > 0) {
        return res.status(httpStatus.BAD_REQUEST).send({ 
            message: `Cannot delete. ${signalCount} active signals are using this symbol.` 
        });
    }

    // 3. Delete
    await MasterSymbol.findByIdAndDelete(id);
    res.status(httpStatus.NO_CONTENT).send();
});

const handleLogin = catchAsync(async (req, res) => {
    const { provider } = req.params;
    const payload = req.body; // { request_token } or { code }
    
    try {
        const session = await marketDataService.handleLogin(provider, payload);
        res.send(session);
    } catch (error) {
        res.status(httpStatus.BAD_REQUEST).send({ message: error.message });
    }
});

const handleLoginCallback = catchAsync(async (req, res) => {
    const { provider } = req.params;
    console.log(`\n--- CALLBACK RECEIVED [${provider}] ---`);
    console.log('Original URL:', req.originalUrl);
    console.log('Query Params:', req.query);

    const { code, request_token, auth_code } = req.query; // standard oauth params
    
    const finalCode = code || request_token || auth_code;
    
    if (!finalCode) {
        console.error(' Missing Code in Query params');
        return res.status(httpStatus.BAD_REQUEST).send(`
            <h1>Login Failed</h1>
            <p>No 'code' found in URL.</p>
            <p>Debug Data:</p>
            <pre>${JSON.stringify(req.query, null, 2)}</pre>
            <p>Ensure you did not remove parameters from the URL.</p>
        `);
    }

    try {
        await marketDataService.handleLogin(provider, { code: finalCode, request_token: finalCode });
        res.send('<h1>Login Successful!</h1><p>Token Generated. You can close this window.</p>');
    } catch (error) {
        console.error('Login Handling Error:', error);
        res.status(httpStatus.INTERNAL_SERVER_ERROR).send(`Login Failed: ${error.message}`);
    }
});

const getLoginUrl = catchAsync(async (req, res) => {
    const { provider } = req.params;
    
    // Ensure service uses latest settings
    await marketDataService.loadSettings();
    
    // Validate Provider
    let adapter = null;
    if (provider === 'kite') adapter = kiteService;
    else return res.status(httpStatus.BAD_REQUEST).send({ message: 'Invalid Provider' });

    // Check if key is configured (using generic keys from settings)
    // Check if key is configured (using generic keys from settings)
    let apiKey = null;
    let apiSecret = null;

    if (provider === 'kite') {
        apiKey = marketDataService.config.kite_api_key;
        apiSecret = marketDataService.config.kite_api_secret;
    } else if (provider === 'alltick') {
        apiKey = marketDataService.config.alltick_api_key;
    }
    
    // Fallback or generic (if still needed)
    if (!apiKey) apiKey = marketDataService.config.data_feed_api_key;
    if (!apiSecret) apiSecret = marketDataService.config.data_feed_api_secret;

    if (!apiKey) {
        return res.status(httpStatus.BAD_REQUEST).send({ message: 'API Key not configured' });
    }

    // Initialize specific adapter
    // For Login URL we typically only need API Key and Redirect URI
    // But generic init requires both usually.
    // Construct Redirect URI based on provider
    const redirectUri = `${req.protocol}://${req.get('host')}/market/login/${provider}/callback`; // e.g. NOT REAL ROUTE? 
    // Wait, the frontend handles redirect usually.
    // Let's assume the redirect_uri is fixed or backend generated.
    // Actually, for Kite it's set in App Console. For others passing it is allowed.
    // Let's use a standard localhost URI for now or what user configured.
    // Ideally user configures "Redirect URI" in settings but we don't have that field yet.
    // We will hardcode `http://localhost:5173/market/login/${provider}` (Frontend Route) as redirect.
    // OR backend route? Usually frontend receives code and POSTs to backend.
    
    const frontendCallback = `${config.frontendUrl}/market/login/${provider}`; // Frontend Page
    
    adapter.initialize(apiKey, apiSecret, frontendCallback);

    const url = adapter.getLoginUrl();
    res.send({ url });
});

const getHistory = catchAsync(async (req, res) => {
    const { symbol, resolution, from, to } = req.query;
    
    logger.info(`[HISTORY_REQUEST] Received from ${req.ip} - Symbol: ${symbol}, Resolution: ${resolution}, From: ${from}, To: ${to}`);
    logger.info(`[HISTORY_REQUEST] Headers: ${JSON.stringify(req.headers)}`);
    
    if (!symbol || !resolution || !from || !to) {
        logger.warn(`[HISTORY_REQUEST] Missing parameters!`);
        return res.status(httpStatus.BAD_REQUEST).send({ message: 'Missing required parameters: symbol, resolution, from, to' });
    }

    logger.info(`History Request: ${symbol} (${resolution}) from ${from} to ${to}`);
    const history = await marketDataService.getHistory(symbol, resolution, from, to);
    logger.info(`[HISTORY_RESPONSE] Returning ${history.length} candles for ${symbol}`);
    res.send(history);
});

const searchInstruments = catchAsync(async (req, res) => {
    const { q } = req.query;
    let instruments = await marketDataService.searchInstruments(q);

    // Strict Segment Filtering based on User Plan
    if (req.user) {
        try {
            const { default: authService } = await import('../services/auth.service.js');
            const planData = await authService.getUserActivePlan(req.user);
            
            if (planData && planData.permissions.length > 0) {
                const perms = planData.permissions;
                const allowedSegments = [];
                const allowedExchanges = [];

                // 1. Map Permissions to Allowed Data Segments/Exchanges
                if (perms.includes('COMMODITY') || perms.includes('MCX_FUT')) {
                    allowedSegments.push('COMMODITY');
                    allowedExchanges.push('MCX'); 
                }
                if (perms.includes('EQUITY_INTRA') || perms.includes('EQUITY_DELIVERY')) {
                    allowedSegments.push('EQUITY', 'INDICES');
                    allowedExchanges.push('NSE', 'BSE');
                }
                if (perms.includes('NIFTY_OPT') || perms.includes('BANKNIFTY_OPT')) {
                    allowedSegments.push('FNO', 'INDICES'); 
                    allowedExchanges.push('NFO', 'MCX', 'CDS', 'BCD'); 
                }
                if (perms.includes('CURRENCY')) {
                    allowedSegments.push('CURRENCY');
                    allowedExchanges.push('CDS', 'BCD', 'FOREX');
                }
                if (perms.includes('CRYPTO')) {
                    allowedSegments.push('CRYPTO');
                    allowedExchanges.push('BINANCE', 'CRYPTO');
                }

                
                // Allow "Demo" plan to see everything OR restrict? 
                // User said: "Demo plan... commodity segment... sirf commodity dena hai"
                // So even Demo follows restriction if it has a segment attached.
                
                // 3. Filter Logic
                // If we have ANY restrictions, apply them. If no active sub found (or free user?), maybe allow all or restrict?
                // Assuming strict: If user has a plan, STRICTLY follow plan. 
                
                if (allowedSegments.length > 0 || allowedExchanges.length > 0) {
                     instruments = instruments.filter(item => {
                        const seg = item.segment || ''; // e.g. EQUITY, COMMODITY
                        const exc = item.exchange || ''; // e.g. NSE, MCX
                        
                        // Check if Item matches Allowed Segment OR Allowed Exchange
                        const segmentMatch = allowedSegments.includes(seg);
                        const exchangeMatch = allowedExchanges.includes(exc);
                        
                        return segmentMatch || exchangeMatch;
                    });
                }
            }
        } catch (err) {
            logger.error(`Error filtering segments for user ${req.user.id}: ${err.message}`);
            // On error, maybe fail open or closed? 
            // Better to fail open (return results) or log? 
            // Let's return filtered if possible, but if error, return all (fallback)
        }
    }

    res.send(instruments);
});

const syncInstruments = catchAsync(async (req, res) => {
    const result = await marketDataService.syncInstruments();
    res.send(result);
});

export default {
    seedMarketData,
    getSegments,
    createSegment,
    deleteSegment,
    updateSegment,
    getSymbols,
    createSymbol,
    updateSymbol,
    deleteSymbol,
    handleLogin,
    handleLoginCallback,
    getLoginUrl,
    getHistory,
    searchInstruments,
    syncInstruments,
    getTickers, // New
    getSentiment, // New
    getSymbolAnalysis,
    getNews,
    getMarketStats: (req, res) => {
        const stats = marketDataService.getStats();
        res.send(stats);
    }
};

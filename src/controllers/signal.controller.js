import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import { signalService, allTickService, technicalAnalysisService } from '../services/index.js';

const getAllowedAccessFromPermissions = (permissions = []) => {
  const perms = Array.isArray(permissions) ? permissions : [];
  const allowedSegments = [];
  const allowedCategories = [];

  // Map Permissions to Segments/Categories
  if (perms.includes('COMMODITY') || perms.includes('MCX_FUT')) {
    allowedSegments.push('COMMODITY', 'MCX');
    allowedCategories.push('MCX_FUT');
  }
  if (perms.includes('EQUITY_INTRA') || perms.includes('EQUITY_DELIVERY')) {
    allowedSegments.push('EQUITY', 'NSE', 'BSE');
    allowedCategories.push('EQUITY_INTRA', 'EQUITY_DELIVERY');
  }
  if (perms.includes('NIFTY_OPT') || perms.includes('BANKNIFTY_OPT') || perms.includes('FINNIFTY_OPT') || perms.includes('STOCK_OPT')) {
    allowedSegments.push('FNO', 'NFO', 'CDS');
    allowedCategories.push('NIFTY_OPT', 'BANKNIFTY_OPT', 'STOCK_OPT', 'FINNIFTY_OPT');
  }
  if (perms.includes('CURRENCY')) {
    allowedSegments.push('CURRENCY', 'CDS', 'BCD');
    allowedCategories.push('CURRENCY');
  }
  if (perms.includes('CRYPTO')) {
    allowedSegments.push('CRYPTO', 'BINANCE');
    allowedCategories.push('CRYPTO');
  }
  if (perms.includes('BTST')) {
    allowedSegments.push('EQUITY', 'NSE', 'BSE');
    allowedCategories.push('BTST');
  }
  if (perms.includes('HERO_ZERO')) {
    allowedSegments.push('EQUITY', 'NSE', 'BSE');
    allowedCategories.push('HERO_ZERO');
  }

  return { allowedSegments, allowedCategories };
};

const getSignalAccessContext = async (req) => {
  const tokenProvided = Boolean(req.headers.authorization);

  if (!req.user) {
    return {
      mode: 'guest',
      tokenProvided,
      planStatus: null,
      planName: null,
      planExpiry: null,
      permissions: [],
      allowedSegments: [],
      allowedCategories: [],
      scope: 'free_only',
      message: 'Guest mode: only free signals are visible. Login to view premium signals.'
    };
  }

  if (req.user.role === 'admin') {
    return {
      mode: 'admin',
      tokenProvided,
      planStatus: 'active',
      planName: 'admin',
      planExpiry: null,
      permissions: [],
      allowedSegments: [],
      allowedCategories: [],
      scope: 'all',
      message: null
    };
  }

  const { default: authService } = await import('../services/auth.service.js');
  const planData = await authService.getUserActivePlan(req.user);
  const permissions = Array.isArray(planData?.permissions) ? planData.permissions : [];
  const now = new Date();
  const planExpiry = planData?.planExpiry ? new Date(planData.planExpiry) : null;
  const planExpiryValid = planExpiry instanceof Date && !Number.isNaN(planExpiry.getTime());
  const isActiveByExpiry = planExpiryValid && planExpiry > now;
  const hasPlanId = Boolean(planData?.planId);
  const planStatus = isActiveByExpiry || permissions.length > 0 || (hasPlanId && !planExpiryValid) ? 'active' : 'expired';

  const { allowedSegments, allowedCategories } =
    planStatus === 'active' ? getAllowedAccessFromPermissions(permissions) : { allowedSegments: [], allowedCategories: [] };

  return {
    mode: 'user',
    tokenProvided,
    planStatus,
    planName: planData?.planName || null,
    planExpiry: planData?.planExpiry || null,
    permissions,
    allowedSegments,
    allowedCategories,
    scope: allowedSegments.length > 0 || allowedCategories.length > 0 ? 'free_and_subscribed' : 'free_only',
    message:
      planStatus === 'active'
        ? null
        : 'Plan expired: only free signals are visible. Renew to view premium signals.'
  };
};

const buildBaseFilterForAccess = (access) => {
  if (access.mode === 'admin') return {};
  if (!access.allowedSegments?.length && !access.allowedCategories?.length) return { isFree: true };

  return {
    $or: [
      { isFree: true },
      {
        $or: [
          { segment: { $in: access.allowedSegments } },
          { category: { $in: access.allowedCategories } }
        ]
      }
    ]
  };
};

const assertSignalAccess = (access, signal) => {
  if (access.mode === 'admin') return;
  if (signal.isFree) return;

  if (access.mode === 'guest') {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Please login to view this signal');
  }

  if (access.planStatus !== 'active') {
    throw new ApiError(httpStatus.FORBIDDEN, 'Plan expired. Please renew to view premium signals.');
  }

  const hasAccess =
    (access.allowedSegments || []).includes(signal.segment) ||
    (access.allowedCategories || []).includes(signal.category);

  if (!hasAccess) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You do not have access to this signal');
  }
};

const createSignal = catchAsync(async (req, res) => {
  const signal = await signalService.createSignal(req.body, req.user);
  res.status(httpStatus.CREATED).send(signal);
});

const getSignal = catchAsync(async (req, res) => {
  const signal = await signalService.getSignalById(req.params.signalId);
  if (!signal) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Signal not found');
  }

  const access = await getSignalAccessContext(req);
  assertSignalAccess(access, signal);

  res.send(signal);
});

const createManualSignal = catchAsync(async (req, res) => {
    // 1. Force Type to 'Manual'
    const payload = { ...req.body, isManual: true, status: 'Active' };
    
    // 2. Create via Service
    const signal = await signalService.createSignal(payload, req.user);

    // 3. Emit Socket Event (Critical for Live Chart)
    // signalService.createSignal usually emits, but let's ensure it.
    // Assuming service handles emission.
    
    res.status(httpStatus.CREATED).send(signal);
});

const getSignals = catchAsync(async (req, res) => {
  // Logic: Show all if admin. If user/guest, show Free OR Subscribed segments.
  let filter = {};
  const { page = 1, limit = 10 } = req.query;

  const access = await getSignalAccessContext(req);
  if (access.mode === 'user' && access.planStatus !== 'active') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Plan expired. Please renew to view signals.');
  }

  // 1. Build Base Filter (Permissions)
  const baseFilter = buildBaseFilterForAccess(access);

  // 2. Build Query Filters Array
  const { search, symbol, status, segment, type, dateFilter, signalId } = req.query;
  const conditions = [baseFilter];

  if (search) {
      conditions.push({ symbol: { $regex: search, $options: 'i' } });
  }

  if (symbol) {
      conditions.push({ symbol: symbol });
  }

  if (dateFilter && dateFilter !== 'All') {
      const now = new Date();
      let start = new Date(now);
      let end = new Date(now);
      
      if (dateFilter === 'Today') {
          start.setHours(0, 0, 0, 0);
          end.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'Yesterday') {
          start.setDate(now.getDate() - 1);
          start.setHours(0, 0, 0, 0);
          end.setDate(now.getDate() - 1);
          end.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'This Week') {
          const day = now.getDay(); 
          const diff = now.getDate() - day + (day === 0 ? -6 : 1); 
          start = new Date(now.setDate(diff));
          start.setHours(0, 0, 0, 0);
          end.setHours(23, 59, 59, 999);
      }
      
      conditions.push({ createdAt: { $gte: start, $lte: end } });
  }

  if (status && status !== 'All') {
      if (status === '!Closed') {
          conditions.push({ status: { $ne: 'Closed' } });
      } else if (status === 'History') {
          conditions.push({ status: { $in: ['Closed', 'Target Hit', 'Stoploss Hit'] } });
      } else {
          conditions.push({ status: status });
      }
  }

  if (segment && segment !== 'All') {
      conditions.push({ segment: segment });
  }

  if (type && type !== 'All') {
      conditions.push({ type: type.toUpperCase() });
  }

  if (signalId) {
      conditions.push({ _id: signalId });
  }

  if (req.query.timeframe) {
      conditions.push({ timeframe: req.query.timeframe });
  }

  // Final Composite Filter
  filter = conditions.length > 1 ? { $and: conditions } : conditions[0];

  // 3. Query Data
  const signalsData = await signalService.querySignals(filter, { page, limit });
  
  // 4. Get Visible Stats (based on access scope)
  const stats = await signalService.getSignalStats(baseFilter);

  const formattedResults = signalsData.results.map(s => ({
      id: s._id,
      uniqueId: s.uniqueId,
      webhookId: s.webhookId,
      symbol: s.symbol,
      type: s.type,
      entry: s.entryPrice,
      stoploss: s.stopLoss,
      status: s.status,
      timestamp: s.createdAt,
      createdAt: s.createdAt,
      signalTime: s.signalTime,
      exitPrice: s.exitPrice,
      totalPoints: s.totalPoints,
      exitReason: s.exitReason,
      exitTime: s.exitTime,
      segment: s.segment,
      category: s.category,
      targets: s.targets,
      isFree: s.isFree,
      notes: s.notes,
      strategyId: s.strategyId,
      strategyName: s.strategyName,
      timeframe: s.timeframe,
      metrics: s.metrics
  }));

  res.send({
      access: {
          mode: access.mode,
          scope: access.scope,
          tokenProvided: access.tokenProvided,
          planStatus: access.planStatus,
          planName: access.planName,
          planExpiry: access.planExpiry,
          message: access.message
      },
      results: formattedResults,
      pagination: {
          page: signalsData.page,
          limit: signalsData.limit,
          totalPages: signalsData.totalPages,
          totalResults: signalsData.totalResults
      },
      stats
  });
});

const updateSignal = catchAsync(async (req, res) => {
    const signal = await signalService.updateSignalById(req.params.signalId, req.body);
    res.send(signal);
});

const deleteSignal = catchAsync(async (req, res) => {
    await signalService.deleteSignalById(req.params.signalId);
    res.status(httpStatus.NO_CONTENT).send();
});

const getSignalAnalysis = catchAsync(async (req, res) => {
    const { signalId } = req.params;
    
    // 1. Fetch Signal to get Symbol
    const signal = await signalService.getSignalById(signalId);
    if (!signal) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Signal not found');
    }

    const access = await getSignalAccessContext(req);
    assertSignalAccess(access, signal);

    const symbol = signal.symbol;

    // 2. Fetch Candles Parallel (5m, 15m, 1H, 1D)
    const now = new Date();
    const from = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 Days back is enough for 1H/15m logic
    
    const [c5m, c15m, c1H, c1D] = await Promise.all([
        allTickService.getHistoricalData(symbol, '5m', from, now),
        allTickService.getHistoricalData(symbol, '15m', from, now),
        allTickService.getHistoricalData(symbol, '1H', from, now),
        allTickService.getHistoricalData(symbol, '1D', from, now),
    ]);

    // 3. Helper to Calculate Hybrid Logic per Timeframe
    const analyzeTimeframe = (candles, timeframeName) => {
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
        const st = technicalAnalysisService.calculateSupertrend(haCandles, 14, 1.5);
        const psar = technicalAnalysisService.calculatePSAR(haCandles);
        const structure = technicalAnalysisService.calculateMarketStructure(haCandles, 5);
        
        const lastCandle = candles[candles.length - 1]; // Use Standard Price for Levels
        const currentPrice = lastCandle.close;

        // Determine Signal Status on Last Complete Candle
        // Or current state? Dashboard usually shows Current Trend.
        const trend = st.trend === 1 ? 'BULLISH' : 'BEARISH';
        
        // Signal Logic (Replicating Hybrid)
        let signalType = 'HOLD'; // or BUY/SELL if fresh
        if (st.isBuy) signalType = 'BUY';
        if (st.isSell) signalType = 'SELL';
        
        // Check Confluence for "Strong" status
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
    };

    const analysis = {
        scan_5m: analyzeTimeframe(c5m, '5m'),
        scan_15m: analyzeTimeframe(c15m, '15m'),
        scan_1h: analyzeTimeframe(c1H, '1H'),
    };

    // 4. Calculate Daily Volatility Levels
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
            buyPrice: currentPrice + (atr * 0.2), // Pivot approximation
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

export default {
  createSignal,
  createManualSignal,
  getSignal,
  getSignals,
  getSignalAnalysis,
  updateSignal,
  deleteSignal
};

import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import ApiError from '../utils/ApiError.js';
import MasterSymbol from '../models/MasterSymbol.js';
import { signalService, technicalAnalysisService, marketDataService } from '../services/index.js';
import {
  buildSelectedSignalFilter,
  buildSelectedSymbolDocsMap,
  expandSelectedSymbols,
  getUserSelectedSymbols,
  hasSelectedSignalSymbol,
} from '../utils/userSignalSelection.js';
import { pickBestMasterSymbol } from '../utils/masterSymbolResolver.js';
import { resolveSymbolSegmentGroup } from '../utils/marketSegmentResolver.js';
import { buildTimeframeQuery, normalizeSignalTimeframe } from '../utils/timeframe.js';

const toFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const roundSignalValue = (value) => Math.round(value * 100) / 100;
const CLOSED_SIGNAL_STATUSES = ['Closed', 'Target Hit', 'Partial Profit Book', 'Stoploss Hit'];

const resolveSignalDisplaySegment = (signal) => {
  const category = String(signal?.category || '').trim().toUpperCase();
  if (['NIFTY_OPT', 'BANKNIFTY_OPT', 'FINNIFTY_OPT', 'STOCK_OPT'].includes(category)) return 'FNO';
  if (category === 'MCX_FUT') return 'COMMODITY';
  if (category === 'CURRENCY') return 'CURRENCY';
  if (category === 'CRYPTO') return 'CRYPTO';
  return resolveSymbolSegmentGroup({
    symbol: signal?.symbol,
    segment: signal?.segment,
    exchange: signal?.exchange,
    name: signal?.symbol,
  });
};

const getResolvedSignalExitPrice = (signal) => {
  const exitPrice = toFiniteNumber(signal?.exitPrice);
  const stopLoss = toFiniteNumber(signal?.stopLoss);
  const entryPrice = toFiniteNumber(signal?.entryPrice);
  const status = String(signal?.status || '').trim().toLowerCase();

  if (typeof exitPrice !== 'number') {
    if (status.includes('stop') && typeof stopLoss === 'number') return stopLoss;
    return undefined;
  }

  if (status.includes('stop') && typeof stopLoss === 'number' && typeof entryPrice === 'number') {
    const derivedFromExit = Math.abs(exitPrice - entryPrice);
    const derivedFromStop = Math.abs(stopLoss - entryPrice);
    const maxReasonableMove = Math.max(10, derivedFromStop * 5);

    if (derivedFromStop > 0 && derivedFromExit > maxReasonableMove) {
      return stopLoss;
    }
  }

  return exitPrice;
};

const getResolvedSignalPoints = (signal) => {
  const storedPoints = toFiniteNumber(signal?.totalPoints);
  const entryPrice = toFiniteNumber(signal?.entryPrice);
  const exitPrice = getResolvedSignalExitPrice(signal);
  const signalType = String(signal?.type || 'BUY').toUpperCase();

  if (
    typeof storedPoints === 'number' &&
    (Math.abs(storedPoints) > 0 || typeof entryPrice !== 'number' || typeof exitPrice !== 'number')
  ) {
    return roundSignalValue(storedPoints);
  }

  if (typeof entryPrice === 'number' && typeof exitPrice === 'number') {
    const derivedPoints = signalType === 'SELL' ? entryPrice - exitPrice : exitPrice - entryPrice;
    return roundSignalValue(derivedPoints);
  }

  if (typeof storedPoints === 'number') return roundSignalValue(storedPoints);
  return undefined;
};

const toCsvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const normalizeSignalLookupKey = (value) => String(value || '').trim().toUpperCase();

const resolveSignalMasterSymbols = async (signals = []) => {
  const rawSymbols = Array.from(
    new Set(
      (Array.isArray(signals) ? signals : [])
        .map((signal) => String(signal?.symbol || '').trim())
        .filter(Boolean)
    )
  );

  if (rawSymbols.length === 0) return new Map();

  const aliasPool = Array.from(
    new Set(
      rawSymbols.flatMap((symbol) =>
        expandSelectedSymbols([symbol]).map((item) => normalizeSignalLookupKey(item))
      )
    )
  );

  const masterSymbols = await MasterSymbol.find({
    $or: [
      { symbol: { $in: aliasPool } },
      { sourceSymbol: { $in: aliasPool } },
      ...rawSymbols.map((symbol) => ({ name: new RegExp(`^${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })),
    ],
  })
    .select('symbol name segment exchange sourceSymbol')
    .sort({ isActive: -1, updatedAt: -1, symbol: 1 })
    .lean();

  const resolvedByRawSymbol = new Map();

  for (const rawSymbol of rawSymbols) {
    const normalizedRaw = normalizeSignalLookupKey(rawSymbol);
    const aliases = new Set(expandSelectedSymbols([rawSymbol]).map((item) => normalizeSignalLookupKey(item)));
    aliases.add(normalizedRaw);
    const candidates = masterSymbols.filter((doc) => {
      const symbol = normalizeSignalLookupKey(doc?.symbol);
      const sourceSymbol = normalizeSignalLookupKey(doc?.sourceSymbol);
      const name = normalizeSignalLookupKey(doc?.name);
      return aliases.has(symbol) || aliases.has(sourceSymbol) || name === normalizedRaw;
    });
    const resolved = pickBestMasterSymbol(rawSymbol, candidates);

    if (resolved) {
      resolvedByRawSymbol.set(normalizedRaw, resolved);
    }
  }

  return resolvedByRawSymbol;
};

const formatSignalResponse = (signal, resolvedMasterSymbol = null) => {
  const canonicalSymbol = String(resolvedMasterSymbol?.symbol || signal.symbol || '').trim().toUpperCase();
  const symbolName = String(resolvedMasterSymbol?.name || signal.symbol || '').trim();
  const originalSymbol = String(signal?.symbol || '').trim().toUpperCase();
  const segment = resolvedMasterSymbol
    ? resolveSignalDisplaySegment({
        ...signal,
        symbol: canonicalSymbol,
        segment: resolvedMasterSymbol.segment,
        exchange: resolvedMasterSymbol.exchange,
      })
    : resolveSignalDisplaySegment(signal);

  return {
    id: signal._id,
    uniqueId: signal.uniqueId,
    webhookId: signal.webhookId,
    symbol: canonicalSymbol,
    symbolName,
    originalSymbol,
    sourceSymbol: String(resolvedMasterSymbol?.sourceSymbol || canonicalSymbol || '').trim().toUpperCase(),
    type: signal.type,
    entry: signal.entryPrice,
    stoploss: signal.stopLoss,
    status: signal.status,
    timestamp: signal.createdAt,
    createdAt: signal.createdAt,
    signalTime: signal.signalTime,
    exitPrice: getResolvedSignalExitPrice(signal),
    totalPoints: getResolvedSignalPoints(signal),
    exitReason: signal.exitReason,
    exitTime: signal.exitTime,
    segment,
    category: signal.category,
    targets: signal.targets,
    isFree: signal.isFree,
    notes: signal.notes,
    strategyId: signal.strategyId,
    strategyName: signal.strategyName,
    timeframe: normalizeSignalTimeframe(signal.timeframe) || signal.timeframe,
    metrics: signal.metrics,
  };
};

const getStartOfDay = (date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const getEndOfDay = (date) => {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
};

const resolveSignalDateRange = ({ datePreset, dateFilter, fromDate, toDate }) => {
  const preset = String(datePreset || dateFilter || '').trim().toLowerCase();
  const now = new Date();

  if (!preset || preset === 'all') return null;

  if (preset === 'today') {
    return { start: getStartOfDay(now), end: getEndOfDay(now) };
  }

  if (preset === 'yesterday') {
    const day = new Date(now);
    day.setDate(day.getDate() - 1);
    return { start: getStartOfDay(day), end: getEndOfDay(day) };
  }

  if (preset === 'tomorrow') {
    const day = new Date(now);
    day.setDate(day.getDate() + 1);
    return { start: getStartOfDay(day), end: getEndOfDay(day) };
  }

  if (preset === 'week' || preset === 'this week') {
    const start = getStartOfDay(now);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
    return { start, end: getEndOfDay(now) };
  }

  if (preset === 'month' || preset === 'this month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start, end: getEndOfDay(now) };
  }

  if (preset === 'custom') {
    const start = fromDate ? getStartOfDay(new Date(fromDate)) : null;
    const end = toDate ? getEndOfDay(new Date(toDate)) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return null;
    }
    return { start, end };
  }

  return null;
};

const getAllowedAccessFromPermissions = (permissions = []) => {
  const perms = Array.isArray(permissions) ? permissions : [];
  const allowedSegments = [];
  const allowedCategories = [];

  // Map Permissions to Segments/Categories
  if (perms.includes('COMMODITY') || perms.includes('MCX_FUT')) {
    allowedSegments.push('COMMODITY', 'COMEX', 'MCX');
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
    allowedSegments.push('CRYPTO');
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
      selectedSymbols: [],
      selectedSymbolCount: 0,
      signalVisibleFrom: null,
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
      selectedSymbols: [],
      selectedSymbolCount: 0,
      signalVisibleFrom: null,
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
  const rawSelectedSymbols = getUserSelectedSymbols(req.user);
  const signalVisibleFrom = req.user?.createdAt ? new Date(req.user.createdAt) : null;
  const selectedSymbolDocs = rawSelectedSymbols.length > 0
    ? await MasterSymbol.find({ symbol: { $in: rawSelectedSymbols } }).select('symbol segment exchange').lean()
    : [];
  const selectedSymbols = getUserSelectedSymbols(req.user, buildSelectedSymbolDocsMap(selectedSymbolDocs));
  const requiresSelection = planStatus === 'active';
  const selectionMessage = requiresSelection && selectedSymbols.length === 0
    ? 'Select scripts in your watchlist to receive signals. Signals are unlimited for selected scripts, but you can add only 10 scripts per segment.'
    : null;

  return {
    mode: 'user',
    tokenProvided,
    planStatus,
    planName: planData?.planName || null,
    planExpiry: planData?.planExpiry || null,
    permissions,
    allowedSegments,
    allowedCategories,
    selectedSymbols,
    selectedSymbolCount: selectedSymbols.length,
    signalVisibleFrom:
      signalVisibleFrom instanceof Date && !Number.isNaN(signalVisibleFrom.getTime())
        ? signalVisibleFrom
        : null,
    scope: allowedSegments.length > 0 || allowedCategories.length > 0 ? 'free_and_subscribed' : 'free_only',
    message:
      planStatus === 'active'
        ? selectionMessage
        : 'Plan expired: only free signals are visible. Renew to view premium signals.'
  };
};

const buildBaseFilterForAccess = (access) => {
  if (access.mode === 'admin') return {};

  const enforceWatchlist =
    String(process.env.SIGNAL_REQUIRE_WATCHLIST || '').trim().toLowerCase() === 'true';
  const selectedSymbolFilter =
    enforceWatchlist &&
    access.mode === 'user' &&
    Array.isArray(access.selectedSymbols) &&
    access.selectedSymbols.length > 0
      ? buildSelectedSignalFilter(access.selectedSymbols)
      : null;
  let accessFilter = !access.allowedSegments?.length && !access.allowedCategories?.length
    ? { isFree: true }
    : {
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

  if (selectedSymbolFilter) {
    accessFilter = { $and: [accessFilter, selectedSymbolFilter] };
  }

  if (access.mode === 'user' && access.signalVisibleFrom instanceof Date && !Number.isNaN(access.signalVisibleFrom.getTime())) {
    accessFilter = {
      $and: [
        accessFilter,
        { createdAt: { $gte: access.signalVisibleFrom } }
      ]
    };
  }

  return accessFilter;
};

const assertSignalAccess = (access, signal) => {
  if (access.mode === 'admin') return;
  const enforceWatchlist =
    String(process.env.SIGNAL_REQUIRE_WATCHLIST || '').trim().toLowerCase() === 'true';
  if (
    enforceWatchlist &&
    access.mode === 'user' &&
    !hasSelectedSignalSymbol(access.selectedSymbols, signal.symbol)
  ) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You only receive signals for scripts selected in your watchlist.');
  }

  if (
    access.mode === 'user' &&
    access.signalVisibleFrom instanceof Date &&
    !Number.isNaN(access.signalVisibleFrom.getTime()) &&
    signal?.createdAt &&
    new Date(signal.createdAt).getTime() < access.signalVisibleFrom.getTime()
  ) {
    throw new ApiError(httpStatus.FORBIDDEN, 'This signal was generated before your account became active.');
  }

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

  const symbolMap = await resolveSignalMasterSymbols([signal]);
  res.send(formatSignalResponse(signal, symbolMap.get(normalizeSignalLookupKey(signal.symbol)) || null));
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
  const { search, symbol, status, segment, type, dateFilter, datePreset, fromDate, toDate, signalId } = req.query;
  const conditions = [baseFilter];

  if (search) {
      conditions.push({
        $or: [
          { symbol: { $regex: search, $options: 'i' } },
          { uniqueId: { $regex: search, $options: 'i' } },
          { webhookId: { $regex: search, $options: 'i' } },
          { strategyName: { $regex: search, $options: 'i' } },
        ],
      });
  }

  if (symbol) {
      conditions.push(buildSelectedSignalFilter([symbol]));
  }

  const dateRange = resolveSignalDateRange({ datePreset, dateFilter, fromDate, toDate });
  if (dateRange?.start && dateRange?.end) {
      conditions.push({ createdAt: { $gte: dateRange.start, $lte: dateRange.end } });
  }

  if (status && status !== 'All') {
      if (status === '!Closed') {
          conditions.push({ status: { $nin: CLOSED_SIGNAL_STATUSES } });
      } else if (status === 'History') {
          conditions.push({ status: { $in: CLOSED_SIGNAL_STATUSES } });
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
      const timeframeFilter = buildTimeframeQuery('timeframe', req.query.timeframe);
      if (timeframeFilter) {
        conditions.push(timeframeFilter);
      }
  }

  // Final Composite Filter
  filter = conditions.length > 1 ? { $and: conditions } : conditions[0];

  // 3. Query Data
  const signalsData = await signalService.querySignals(filter, { page, limit });
  
  // 4. Get Visible Stats (based on access scope)
  const [stats, periodStats, report] = await Promise.all([
    signalService.getSignalStats(filter),
    signalService.getSignalPeriodStats(baseFilter),
    String(req.query.includeReport || '').trim() === '1' && access.mode === 'admin'
      ? signalService.getSignalReport(filter)
      : Promise.resolve(null),
  ]);

  const symbolMap = await resolveSignalMasterSymbols(signalsData.results);
  const formattedResults = signalsData.results.map((signal) =>
    formatSignalResponse(signal, symbolMap.get(normalizeSignalLookupKey(signal.symbol)) || null)
  );

  res.send({
      access: {
          mode: access.mode,
          scope: access.scope,
      tokenProvided: access.tokenProvided,
      planStatus: access.planStatus,
      planName: access.planName,
      planExpiry: access.planExpiry,
      selectedSymbolCount: access.selectedSymbolCount,
      signalVisibleFrom: access.signalVisibleFrom,
      message: access.message
      },
      results: formattedResults,
      pagination: {
          page: signalsData.page,
          limit: signalsData.limit,
          totalPages: signalsData.totalPages,
          totalResults: signalsData.totalResults
      },
      stats,
      periodStats,
      report
  });
});

const exportSignalReport = catchAsync(async (req, res) => {
  const access = await getSignalAccessContext(req);
  if (access.mode !== 'admin') {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only admins can export signal reports');
  }

  const baseFilter = buildBaseFilterForAccess(access);
  const { search, symbol, status, segment, type, dateFilter, datePreset, fromDate, toDate, signalId } = req.query;
  const conditions = [baseFilter];

  if (search) {
    conditions.push({
      $or: [
        { symbol: { $regex: search, $options: 'i' } },
        { uniqueId: { $regex: search, $options: 'i' } },
        { webhookId: { $regex: search, $options: 'i' } },
        { strategyName: { $regex: search, $options: 'i' } },
      ],
    });
  }

  if (symbol) {
    conditions.push(buildSelectedSignalFilter([symbol]));
  }

  const dateRange = resolveSignalDateRange({ datePreset, dateFilter, fromDate, toDate });
  if (dateRange?.start && dateRange?.end) {
    conditions.push({ createdAt: { $gte: dateRange.start, $lte: dateRange.end } });
  }

  if (status && status !== 'All') {
    if (status === '!Closed') {
      conditions.push({ status: { $nin: CLOSED_SIGNAL_STATUSES } });
    } else if (status === 'History') {
      conditions.push({ status: { $in: CLOSED_SIGNAL_STATUSES } });
    } else {
      conditions.push({ status });
    }
  }

  if (segment && segment !== 'All') {
    conditions.push({ segment });
  }

  if (type && type !== 'All') {
    conditions.push({ type: type.toUpperCase() });
  }

  if (signalId) {
    conditions.push({ _id: signalId });
  }

  if (req.query.timeframe) {
    const timeframeFilter = buildTimeframeQuery('timeframe', req.query.timeframe);
    if (timeframeFilter) {
      conditions.push(timeframeFilter);
    }
  }

  const filter = conditions.length > 1 ? { $and: conditions } : conditions[0];
  const report = await signalService.getSignalReport(filter);

  const summaryRows = [
    ['Report Generated At', new Date().toISOString()],
    ['Date Preset', datePreset || dateFilter || 'all'],
    ['From Date', fromDate || ''],
    ['To Date', toDate || ''],
    ['Search', search || ''],
    ['Segment', segment || 'All'],
    ['Status', status || 'All'],
    ['Type', type || 'All'],
    ['Total Signals', report.summary.totalSignals],
    ['Closed Signals', report.summary.closedSignals],
    ['Active Signals', report.summary.activeSignals],
    ['Winning Signals', report.summary.positiveSignals],
    ['Losing Signals', report.summary.negativeSignals],
    ['Neutral Signals', report.summary.neutralSignals],
    ['Gross Profit Points', report.summary.grossProfitPoints],
    ['Gross Loss Points', report.summary.grossLossPoints],
    ['Net Earnings Points', report.summary.netPoints],
    ['Average Points', report.summary.averagePoints],
    ['Gross Profit INR', report.summary.grossProfitInr],
    ['Gross Loss INR', report.summary.grossLossInr],
    ['Net Earnings INR', report.summary.netInr],
    ['Average INR', report.summary.averageInr],
    ['Win Rate', `${report.summary.winRate}%`],
    ['Target Hit', report.summary.targetHit],
    ['Partial Profit Book', report.summary.partialProfit],
    ['Stoploss Hit', report.summary.stoplossHit],
    ['Closed Without Points', report.summary.closedWithoutPoints],
    ['Lot Size Missing', report.summary.lotSizeMissing],
  ];

  const detailHeaders = [
    'Signal ID',
    'Unique ID',
    'Webhook ID',
    'Symbol',
    'Segment',
    'Category',
    'Type',
    'Status',
    'Entry Price',
    'Stop Loss',
    'Target 1',
    'Target 2',
    'Target 3',
    'Signal Time',
    'Created At',
    'Exit Price',
    'Exit Time',
    'Total Points',
    'Lot Size',
    'Profit INR',
    'Exit Reason',
    'Timeframe',
    'Strategy Name',
    'Is Free',
    'Notes',
  ];

  const csvLines = [
    ...summaryRows.map((row) => row.map((cell) => toCsvCell(cell)).join(',')),
    '',
    detailHeaders.map((cell) => toCsvCell(cell)).join(','),
    ...report.rows.map((row) =>
      [
        row.id,
        row.uniqueId,
        row.webhookId,
        row.symbol,
        row.segment,
        row.category,
        row.type,
        row.status,
        row.entryPrice,
        row.stopLoss,
        row.target1,
        row.target2,
        row.target3,
        row.signalTime ? new Date(row.signalTime).toISOString() : '',
        row.createdAt ? new Date(row.createdAt).toISOString() : '',
        row.exitPrice,
        row.exitTime ? new Date(row.exitTime).toISOString() : '',
        row.totalPoints,
        row.lotSize,
        row.profitInr,
        row.exitReason,
        row.timeframe,
        row.strategyName,
        row.isFree ? 'Yes' : 'No',
        row.notes,
      ].map((cell) => toCsvCell(cell)).join(',')
    ),
  ];

  res.header('Content-Type', 'text/csv');
  res.header(
    'Content-Disposition',
    `attachment; filename="signal_report_${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.send(csvLines.join('\n'));
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
    
    const fromTs = Math.floor(from.getTime() / 1000);
    const toTs = Math.floor(now.getTime() / 1000);

    const [c5m, c15m, c1H, c1D] = await Promise.all([
        marketDataService.getHistory(symbol, '5', fromTs, toTs),
        marketDataService.getHistory(symbol, '15', fromTs, toTs),
        marketDataService.getHistory(symbol, '60', fromTs, toTs),
        marketDataService.getHistory(symbol, 'D', fromTs, toTs),
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
  exportSignalReport,
  getSignalAnalysis,
  updateSignal,
  deleteSignal
};

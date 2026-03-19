import Signal from '../models/Signal.js';
import MasterSymbol from '../models/MasterSymbol.js';
import announcementService from './announcement.service.js';
import logger from '../config/log.js';
import { broadcastToRoles } from './websocket.service.js';
import { getSignalAudienceGroups } from '../utils/signalRouting.js';
import { resolveSymbolSegmentGroup } from '../utils/marketSegmentResolver.js';
import { normalizeSignalTimeframe } from '../utils/timeframe.js';
import { resolveBestMasterSymbol } from '../utils/masterSymbolResolver.js';
import { normalizeSignalTimestampInput } from '../utils/signalTimestamp.js';

const CLOSED_SIGNAL_STATUSES = ['Closed', 'Target Hit', 'Partial Profit Book', 'Stoploss Hit'];
const OPEN_SIGNAL_STATUSES = ['Active', 'Open', 'Paused'];
const SIGNAL_DERIVED_DATES = {
  timezone: 'Asia/Kolkata',
};

const runDetached = (label, task) => {
  setImmediate(async () => {
    try {
      await task();
    } catch (error) {
      logger.error(label, error);
    }
  });
};

const mapSignalToCategory = (signalBody) => {
  const { symbol, segment } = signalBody;
  const sym = symbol ? symbol.toUpperCase() : '';
  const seg = segment ? segment.toUpperCase() : '';

  if ((sym.includes('USDT') || sym.includes('USD')) && seg === 'CRYPTO') return 'CRYPTO';
  if (sym.includes('NIFTY') && !sym.includes('BANK') && !sym.includes('FIN')) return 'NIFTY_OPT';
  if (sym.includes('BANKNIFTY')) return 'BANKNIFTY_OPT';
  if (sym.includes('FINNIFTY')) return 'FINNIFTY_OPT';
  if (seg === 'COMEX' || seg === 'NYMEX') return 'MCX_FUT';
  if (seg === 'MCX' || seg === 'COMMODITY') return 'MCX_FUT';
  if (seg === 'CDS' || seg === 'CURRENCY') return 'CURRENCY';
  if (seg === 'CRYPTO') return 'CRYPTO';
  if (seg === 'EQ' || seg === 'EQUITY') return 'EQUITY_INTRA';

  return 'EQUITY_INTRA';
};

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

const resolveExitPriceFromStatus = (signal, nextStatus) => {
  const status = String(nextStatus || signal?.status || '').trim().toLowerCase();
  const entry = toFiniteNumber(signal?.entryPrice);
  const stopLoss = toFiniteNumber(signal?.stopLoss);
  const t1 = toFiniteNumber(signal?.targets?.target1);
  const t2 = toFiniteNumber(signal?.targets?.target2);
  const t3 = toFiniteNumber(signal?.targets?.target3);

  if (status.includes('stop') && typeof stopLoss === 'number') return stopLoss;
  if (status.includes('target')) {
    if (typeof t1 === 'number') return t1;
    if (typeof t2 === 'number') return t2;
    if (typeof t3 === 'number') return t3;
  }
  if (status.includes('partial')) {
    if (typeof t2 === 'number') return t2;
    if (typeof t1 === 'number') return t1;
    if (typeof t3 === 'number') return t3;
  }
  return entry;
};

const resolveTotalPoints = (signal, exitPrice) => {
  const entry = toFiniteNumber(signal?.entryPrice);
  const exit = toFiniteNumber(exitPrice);
  if (typeof entry !== 'number' || typeof exit !== 'number') return undefined;
  const isSell = String(signal?.type || '').trim().toUpperCase() === 'SELL';
  const points = isSell ? entry - exit : exit - entry;
  return Math.round(points * 100) / 100;
};

const getSignalStartDate = (signal) => {
  const rawValue = signal?.signalTime ?? signal?.createdAt;
  if (!rawValue) return null;

  const parsed = rawValue instanceof Date ? new Date(rawValue) : new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const inferSignalStatusFromExitPrice = (signal, exitPrice) => {
  const resolvedExitPrice = toFiniteNumber(exitPrice);
  const entryPrice = toFiniteNumber(signal?.entryPrice);
  const stopLoss = toFiniteNumber(signal?.stopLoss);
  const target1 = toFiniteNumber(signal?.targets?.target1);

  if (typeof resolvedExitPrice !== 'number' || typeof entryPrice !== 'number') {
    return 'Closed';
  }

  const isSell = String(signal?.type || '').trim().toUpperCase() === 'SELL';

  if (typeof target1 === 'number') {
    const targetReached = isSell ? resolvedExitPrice <= target1 : resolvedExitPrice >= target1;
    if (targetReached) return 'Target Hit';
  }

  if (typeof stopLoss === 'number') {
    const stopReached = isSell ? resolvedExitPrice >= stopLoss : resolvedExitPrice <= stopLoss;
    if (stopReached) return 'Stoploss Hit';
  }

  const resolvedPoints = resolveTotalPoints(signal, resolvedExitPrice);
  if (typeof resolvedPoints === 'number' && resolvedPoints > 0) {
    return 'Partial Profit Book';
  }

  return 'Closed';
};

const scheduleCreateSideEffects = (signal, userId) => {
  runDetached(`Failed side effects for created signal ${signal?.id || signal?._id}`, async () => {
    try {
      broadcastToRoles(['admin', 'sub-broker'], { type: 'new_signal', payload: signal });
    } catch (error) {
      // Passive fail
    }

    try {
      const tpDetails = [
        signal.targets?.target1 ? `TP1: ${signal.targets.target1}` : null,
        signal.targets?.target2 ? `TP2: ${signal.targets.target2}` : null,
        signal.targets?.target3 ? `TP3: ${signal.targets.target3}` : null,
      ]
        .filter((item) => item)
        .join(' | ');

      await announcementService.createAnnouncement({
        title: `Signal: ${signal.symbol} ${signal.type}`,
        message: `Entry: ${signal.entryPrice}\n${tpDetails}\nSL: ${signal.stopLoss}`,
        type: 'SIGNAL',
        priority: 'NORMAL',
        targetAudience: { role: 'user', planValues: [], segments: getSignalAudienceGroups(signal) },
        isActive: false,
        isNotificationSent: true,
      });
    } catch (error) {
      logger.error('Failed to create announcement for signal', error);
    }

    try {
      const { redisClient } = await import('./redis.service.js');
      const payload = JSON.stringify({
        ...signal.toJSON(),
        user: userId ?? 'system',
        subType: 'SIGNAL_NEW',
      });
      await redisClient.publish('signals', payload);
      logger.info(`Published new signal ${signal.id} to Redis 'signals' channel`);
    } catch (error) {
      logger.error('Failed to publish signal to Redis', error);
    }
  });
};

const scheduleUpdateSideEffects = (signal, updateBody, signalId, notificationMeta = null) => {
  if (!updateBody.status && !updateBody.notes && !notificationMeta?.subType) return;

  runDetached(`Failed side effects for updated signal ${signalId}`, async () => {
    try {
      broadcastToRoles(['admin', 'sub-broker'], { type: 'update_signal', payload: signal });
    } catch (error) {
      // Passive fail
    }

    try {
      const { redisClient } = await import('./redis.service.js');
      let subType = null;
      const notificationData = { ...signal.toJSON() };

      if (notificationMeta?.subType) {
        subType = notificationMeta.subType;
        Object.assign(notificationData, notificationMeta.data || {});
        if (!notificationData.updateMessage && updateBody.notes) {
          notificationData.updateMessage = updateBody.notes;
        }
      } else if (updateBody.status === 'Target Hit') {
        subType = 'SIGNAL_TARGET';
        notificationData.targetLevel = 'TP1';
      } else if (updateBody.status === 'Partial Profit Book') {
        subType = 'SIGNAL_PARTIAL_PROFIT';
        notificationData.currentPrice = signal.exitPrice ?? signal.entryPrice;
      } else if (updateBody.status === 'Stoploss Hit') {
        subType = 'SIGNAL_STOPLOSS';
      } else if (updateBody.notes || updateBody.status) {
        subType = 'SIGNAL_UPDATE';
        notificationData.updateMessage = updateBody.notes || `Status changed to ${updateBody.status}`;
      }

      if (subType) {
        await redisClient.publish(
          'signals',
          JSON.stringify({
            ...notificationData,
            subType,
          })
        );
        logger.info(`Published ${subType} notification for signal ${signalId}`);
      }
    } catch (error) {
      logger.error('Failed to emit socket/redis event for update signal', error);
    }
  });
};

const signalCreationGuard = new Map();

const normalizePersistedSignalDates = (payload = {}) => {
  if (payload.signalTime !== undefined) {
    payload.signalTime = normalizeSignalTimestampInput(payload.signalTime);
  }

  if (payload.exitTime !== undefined) {
    payload.exitTime = normalizeSignalTimestampInput(payload.exitTime);
  }
};

const hydrateSignalSegment = async (signalBody = {}) => {
  const normalizedSymbol = String(signalBody?.symbol || '').trim().toUpperCase();
  if (!normalizedSymbol) return signalBody;

  const masterSymbol = await resolveBestMasterSymbol(normalizedSymbol);

  if (masterSymbol) {
    signalBody.symbol = String(masterSymbol.symbol || normalizedSymbol).trim().toUpperCase();
    signalBody.segment = resolveSymbolSegmentGroup(masterSymbol);
    return signalBody;
  }

  if (signalBody.segment) {
    signalBody.segment = resolveSymbolSegmentGroup({
      symbol: normalizedSymbol,
      segment: signalBody.segment,
      exchange: signalBody.exchange,
      name: signalBody.name,
    });
  }

  return signalBody;
};

setInterval(() => {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  for (const [key, timestamp] of signalCreationGuard.entries()) {
    if (timestamp < fiveMinutesAgo) {
      signalCreationGuard.delete(key);
    }
  }
}, 5 * 60 * 1000);

const createSignal = async (signalBody, user) => {
  if (signalBody.timeframe !== undefined) {
    const normalizedTimeframe = normalizeSignalTimeframe(signalBody.timeframe);
    signalBody.timeframe = normalizedTimeframe || signalBody.timeframe;
  }
  if (!signalBody.signalTime) {
    signalBody.signalTime = new Date();
  }
  normalizePersistedSignalDates(signalBody);

  await hydrateSignalSegment(signalBody);
  if (signalBody.uniqueId) {
    signalBody.uniqueId = String(signalBody.uniqueId).trim();
    const existing = await Signal.findOne({ uniqueId: signalBody.uniqueId });
    if (existing) return existing;
  }

  const normalizedSymbol = signalBody.symbol?.toUpperCase().trim();
  const normalizedSegment = String(signalBody.segment || '').trim().toUpperCase();
  const normalizedTimeframe = normalizeSignalTimeframe(signalBody.timeframe) || 'NA';
  const normalizedType = String(signalBody.type || '').trim().toUpperCase();
  const normalizedPrice = Math.round(parseFloat(signalBody.entryPrice) * 100) / 100;
  const dedupKey = signalBody.uniqueId
    ? `UID_${signalBody.uniqueId}`
    : `${normalizedSymbol}_${normalizedSegment}_${normalizedTimeframe}_${normalizedType}_${normalizedPrice}`;
  const now = Date.now();

  if (signalCreationGuard.has(dedupKey)) {
    const lastCreated = signalCreationGuard.get(dedupKey);
    const timeSinceLastSignal = now - lastCreated;

    if (timeSinceLastSignal < 300000) {
      logger.warn(
        `[SIGNAL_GUARD] Blocking duplicate signal for ${dedupKey} (${Math.round(timeSinceLastSignal / 1000)}s ago)`
      );

      if (signalBody.uniqueId) {
        const existing = await Signal.findOne({ uniqueId: signalBody.uniqueId });
        if (existing) return existing;
      }

      return null;
    }
  }

  signalCreationGuard.set(dedupKey, now);

  if (!signalBody.category) {
    signalBody.category = mapSignalToCategory(signalBody);
  }

  let signal;
  try {
    signal = await Signal.create({ ...signalBody, createdBy: user?.id });
  } catch (error) {
    if (signalBody.uniqueId && error?.code === 11000) {
      const existing = await Signal.findOne({ uniqueId: signalBody.uniqueId });
      if (existing) return existing;
    }
    throw error;
  }

  scheduleCreateSideEffects(signal, user?.id);
  return signal;
};

const buildSignalSortSpec = (sortByLatestEvent = false) =>
  sortByLatestEvent
    ? { __eventTime: -1, updatedAt: -1, createdAt: -1, _id: -1 }
    : { createdAt: -1, _id: -1 };

const buildSignalDedupStages = (filter = {}, { sortByLatestEvent = false } = {}) => {
  const stages = [];

  if (filter && Object.keys(filter).length > 0) {
    stages.push({ $match: filter });
  }

  stages.push(
    {
      $addFields: {
        __eventTime: {
          $ifNull: ['$exitTime', { $ifNull: ['$updatedAt', { $ifNull: ['$signalTime', '$createdAt'] }] }],
        },
        __dedupeKey: {
          $switch: {
            branches: [
              {
                case: { $gt: [{ $strLenCP: { $ifNull: ['$uniqueId', ''] } }, 0] },
                then: { $concat: ['UID|', '$uniqueId'] },
              },
              {
                case: { $gt: [{ $strLenCP: { $ifNull: ['$webhookId', ''] } }, 0] },
                then: {
                  $concat: [
                    'WH|',
                    '$webhookId',
                    '|',
                    { $ifNull: ['$symbol', ''] },
                    '|',
                    { $ifNull: ['$segment', ''] },
                    '|',
                    { $ifNull: ['$timeframe', ''] },
                  ],
                },
              },
            ],
            default: {
              $concat: [
                { $ifNull: ['$symbol', ''] },
                '|',
                { $ifNull: ['$segment', ''] },
                '|',
                { $ifNull: ['$type', ''] },
                '|',
                { $ifNull: ['$timeframe', ''] },
                '|',
                { $toString: { $ifNull: ['$entryPrice', ''] } },
                '|',
                {
                  $dateToString: {
                    date: { $ifNull: ['$signalTime', '$createdAt'] },
                    format: '%Y-%m-%dT%H:%M',
                    timezone: SIGNAL_DERIVED_DATES.timezone,
                  },
                },
                '|',
                { $ifNull: ['$strategyName', ''] },
              ],
            },
          },
        },
      },
    },
    { $sort: buildSignalSortSpec(sortByLatestEvent) },
    {
      $group: {
        _id: '$__dedupeKey',
        doc: { $first: '$$ROOT' },
      },
    },
    { $replaceRoot: { newRoot: '$doc' } }
  );

  return stages;
};

const querySignals = async (filter, options) => {
  const page = options.page ? parseInt(options.page) : 1;
  const limit = options.limit ? parseInt(options.limit) : 10;
  const skip = (page - 1) * limit;
  const sortByLatestEvent = Boolean(options?.sortByLatestEvent);
  const sortSpec = buildSignalSortSpec(sortByLatestEvent);

  const baseStages = buildSignalDedupStages(filter, { sortByLatestEvent });
  const [countResult, results] = await Promise.all([
    Signal.aggregate([
      ...baseStages,
      { $count: 'totalResults' },
    ]),
    Signal.aggregate([
      ...baseStages,
      { $sort: sortSpec },
      { $skip: skip },
      { $limit: limit },
      { $project: { __dedupeKey: 0, __eventTime: 0 } },
    ]),
  ]);

  const totalResults = countResult[0]?.totalResults || 0;

  const totalPages = Math.ceil(totalResults / limit);

  return {
    results,
    page,
    limit,
    totalPages,
    totalResults,
  };
};

const getSignalById = async (signalId) => Signal.findById(signalId);

const getSignalStats = async (filter = {}) => {
  const pipeline = [
    ...buildSignalDedupStages(filter),
    {
      $group: {
        _id: null,
        totalSignals: { $sum: 1 },
        activeSignals: {
          $sum: {
            $cond: [{ $in: ['$status', ['Active', 'Open', 'Paused']] }, 1, 0],
          },
        },
        closedSignals: {
          $sum: {
            $cond: [{ $in: ['$status', CLOSED_SIGNAL_STATUSES] }, 1, 0],
          },
        },
        targetHit: {
          $sum: {
            $cond: [{ $eq: ['$status', 'Target Hit'] }, 1, 0],
          },
        },
        partialProfit: {
          $sum: {
            $cond: [{ $eq: ['$status', 'Partial Profit Book'] }, 1, 0],
          },
        },
        stoplossHit: {
          $sum: {
            $cond: [{ $eq: ['$status', 'Stoploss Hit'] }, 1, 0],
          },
        },
      },
    },
  ];

  const stats = await Signal.aggregate(pipeline);
  const data =
    stats[0] || {
      totalSignals: 0,
      activeSignals: 0,
      closedSignals: 0,
      targetHit: 0,
      partialProfit: 0,
      stoplossHit: 0,
    };

  const positiveOutcomes = data.targetHit + data.partialProfit;
  const outcomes = positiveOutcomes + data.stoplossHit;
  const successRate = outcomes > 0 ? Math.round((positiveOutcomes / outcomes) * 100) : 0;

  return {
    ...data,
    successRate,
  };
};

const getSignalPeriodStats = async (filter = {}) => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfWeek = new Date(startOfToday);
  const day = startOfWeek.getDay();
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
  startOfWeek.setDate(diff);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const endOfTomorrow = new Date(startOfTomorrow);
  endOfTomorrow.setHours(23, 59, 59, 999);

  const pipeline = [
    ...buildSignalDedupStages(filter),
    {
      $group: {
        _id: null,
        todaySignals: {
          $sum: {
            $cond: [{ $gte: ['$createdAt', startOfToday] }, 1, 0],
          },
        },
        tomorrowSignals: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ['$createdAt', startOfTomorrow] },
                  { $lte: ['$createdAt', endOfTomorrow] },
                ],
              },
              1,
              0,
            ],
          },
        },
        weeklySignals: {
          $sum: {
            $cond: [{ $gte: ['$createdAt', startOfWeek] }, 1, 0],
          },
        },
        monthlySignals: {
          $sum: {
            $cond: [{ $gte: ['$createdAt', startOfMonth] }, 1, 0],
          },
        },
        planSignals: { $sum: 1 },
      },
    },
  ];

  const result = await Signal.aggregate(pipeline);
  return (
    result[0] || {
      todaySignals: 0,
      tomorrowSignals: 0,
      weeklySignals: 0,
      monthlySignals: 0,
      planSignals: 0,
    }
  );
};

const listSignalsForReport = async (filter = {}) => {
  return Signal.aggregate([
    ...buildSignalDedupStages(filter),
    { $sort: { createdAt: -1, _id: -1 } },
    { $project: { __dedupeKey: 0, __eventTime: 0 } },
  ]);
};

const getSignalReport = async (filter = {}) => {
  const signals = await listSignalsForReport(filter);
  const uniqueSymbols = [...new Set(signals.map((signal) => String(signal?.symbol || '').trim().toUpperCase()).filter(Boolean))];
  const masterSymbols = uniqueSymbols.length
    ? await MasterSymbol.find({ symbol: { $in: uniqueSymbols } }).select('symbol lotSize').lean()
    : [];
  const lotSizeMap = new Map(
    masterSymbols.map((item) => [String(item.symbol || '').trim().toUpperCase(), toFiniteNumber(item.lotSize) || 1])
  );

  const summary = {
    totalSignals: signals.length,
    closedSignals: 0,
    activeSignals: 0,
    positiveSignals: 0,
    negativeSignals: 0,
    neutralSignals: 0,
    targetHit: 0,
    partialProfit: 0,
    stoplossHit: 0,
    closedWithoutPoints: 0,
    grossProfitPoints: 0,
    grossLossPoints: 0,
    netPoints: 0,
    averagePoints: 0,
    grossProfitInr: 0,
    grossLossInr: 0,
    netInr: 0,
    averageInr: 0,
    winRate: 0,
    lotSizeMissing: 0,
  };

  const rows = signals.map((signal) => {
    const resolvedExitPrice = toFiniteNumber(signal?.exitPrice);
    const resolvedPoints = toFiniteNumber(getResolvedSignalPoints(signal));
    const status = String(signal?.status || '').trim();
    const isClosed = CLOSED_SIGNAL_STATUSES.includes(status);
    const symbolKey = String(signal?.symbol || '').trim().toUpperCase();
    const lotSize = lotSizeMap.get(symbolKey) || 1;
    const effectiveLotSize = toFiniteNumber(lotSize) || 1;
    const profitInr = typeof resolvedPoints === 'number' ? roundSignalValue(resolvedPoints * effectiveLotSize) : null;

    if (isClosed) {
      summary.closedSignals += 1;
    } else {
      summary.activeSignals += 1;
    }

    if (status === 'Target Hit') summary.targetHit += 1;
    if (status === 'Partial Profit Book') summary.partialProfit += 1;
    if (status === 'Stoploss Hit') summary.stoplossHit += 1;

    if (isClosed) {
      if (typeof resolvedPoints === 'number') {
        if (resolvedPoints > 0) {
          summary.positiveSignals += 1;
          summary.grossProfitPoints += resolvedPoints;
          summary.grossProfitInr += profitInr || 0;
        } else if (resolvedPoints < 0) {
          summary.negativeSignals += 1;
          summary.grossLossPoints += resolvedPoints;
          summary.grossLossInr += profitInr || 0;
        } else {
          summary.neutralSignals += 1;
        }
        summary.netPoints += resolvedPoints;
        summary.netInr += profitInr || 0;
      } else {
        summary.closedWithoutPoints += 1;
      }
    }

    if (!lotSizeMap.has(symbolKey)) {
      summary.lotSizeMissing += 1;
    }

    return {
      id: String(signal?._id || ''),
      uniqueId: signal?.uniqueId || '',
      webhookId: signal?.webhookId || '',
      symbol: signal?.symbol || '',
      segment: signal?.segment || '',
      category: signal?.category || '',
      type: signal?.type || '',
      status,
      entryPrice: toFiniteNumber(signal?.entryPrice),
      stopLoss: toFiniteNumber(signal?.stopLoss),
      target1: toFiniteNumber(signal?.targets?.target1),
      target2: toFiniteNumber(signal?.targets?.target2),
      target3: toFiniteNumber(signal?.targets?.target3),
      signalTime: signal?.signalTime || null,
      createdAt: signal?.createdAt || null,
      exitPrice: typeof resolvedExitPrice === 'number' ? resolvedExitPrice : null,
      exitTime: signal?.exitTime || null,
      totalPoints: typeof resolvedPoints === 'number' ? resolvedPoints : null,
      exitReason: signal?.exitReason || '',
      timeframe: normalizeSignalTimeframe(signal?.timeframe) || signal?.timeframe || '',
      strategyName: signal?.strategyName || '',
      isFree: Boolean(signal?.isFree),
      notes: signal?.notes || '',
      lotSize: effectiveLotSize,
      profitInr,
    };
  });

  summary.grossProfitPoints = roundSignalValue(summary.grossProfitPoints);
  summary.grossLossPoints = roundSignalValue(summary.grossLossPoints);
  summary.netPoints = roundSignalValue(summary.netPoints);
  summary.grossProfitInr = roundSignalValue(summary.grossProfitInr);
  summary.grossLossInr = roundSignalValue(summary.grossLossInr);
  summary.netInr = roundSignalValue(summary.netInr);

  const settledSignals = summary.positiveSignals + summary.negativeSignals + summary.neutralSignals;
  summary.averagePoints = settledSignals > 0 ? roundSignalValue(summary.netPoints / settledSignals) : 0;
  summary.averageInr = settledSignals > 0 ? roundSignalValue(summary.netInr / settledSignals) : 0;
  summary.winRate =
    settledSignals > 0 ? Math.round((summary.positiveSignals / settledSignals) * 100) : 0;

  return {
    summary,
    rows,
  };
};

const updateSignalById = async (signalId, updateBody) => {
  const signal = await Signal.findById(signalId);
  if (!signal) {
    throw new Error('Signal not found');
  }

  const { notificationMeta = null, skipSideEffects = false, ...persistedUpdateBody } = updateBody || {};
  if (persistedUpdateBody.timeframe !== undefined) {
    const normalizedTimeframe = normalizeSignalTimeframe(persistedUpdateBody.timeframe);
    persistedUpdateBody.timeframe = normalizedTimeframe || persistedUpdateBody.timeframe;
  }
  normalizePersistedSignalDates(persistedUpdateBody);
  if (persistedUpdateBody.symbol || persistedUpdateBody.segment) {
    await hydrateSignalSegment(persistedUpdateBody);
  }
  const previousStatus = String(signal.status || '').trim();
  const nextStatus = String(persistedUpdateBody?.status || '').trim();
  const isReopeningToActive =
    nextStatus === 'Active' && CLOSED_SIGNAL_STATUSES.includes(previousStatus);

  if ((persistedUpdateBody.symbol || persistedUpdateBody.segment) && !persistedUpdateBody.category) {
    const merged = { ...signal.toObject(), ...persistedUpdateBody };
    persistedUpdateBody.category = mapSignalToCategory(merged);
  } else if (!signal.category && !persistedUpdateBody.category) {
    persistedUpdateBody.category = mapSignalToCategory(signal);
  }

  Object.assign(signal, persistedUpdateBody);

  if (persistedUpdateBody?.status && CLOSED_SIGNAL_STATUSES.includes(persistedUpdateBody.status)) {
    if (signal.exitPrice === undefined || signal.exitPrice === null) {
      const exitPrice = resolveExitPriceFromStatus(signal, persistedUpdateBody.status);
      if (typeof exitPrice === 'number') {
        signal.exitPrice = exitPrice;
      }
    }

    if (signal.totalPoints === undefined || signal.totalPoints === null) {
      const derivedPoints = resolveTotalPoints(signal, signal.exitPrice);
      if (typeof derivedPoints === 'number') {
        signal.totalPoints = derivedPoints;
      }
    }

    if (!signal.exitTime) {
      signal.exitTime = new Date();
    }
  }

  if (isReopeningToActive) {
    signal.exitPrice = undefined;
    signal.totalPoints = undefined;
    signal.exitReason = undefined;
    signal.exitTime = undefined;
  }

  await signal.save();
  if (!skipSideEffects) {
    scheduleUpdateSideEffects(signal, persistedUpdateBody, signalId, notificationMeta);
  }
  return signal;
};

const settleOppositeActiveSignalsForEntry = async ({
  symbol,
  segment,
  timeframe,
  type,
  entryPrice,
  signalTime,
  excludeSignalId = null,
  skipSideEffects = true,
} = {}) => {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const normalizedSegment = String(segment || '').trim().toUpperCase();
  const normalizedTimeframe = normalizeSignalTimeframe(timeframe) || String(timeframe || '').trim();
  const normalizedType = String(type || '').trim().toUpperCase();
  const nextEntryPrice = toFiniteNumber(entryPrice);
  const nextSignalTime = normalizeSignalTimestampInput(signalTime) || new Date();

  if (!normalizedSymbol || !normalizedType || typeof nextEntryPrice !== 'number') {
    return [];
  }

  const filter = {
    symbol: normalizedSymbol,
    status: { $in: OPEN_SIGNAL_STATUSES },
    type: { $ne: normalizedType },
  };

  if (normalizedSegment) {
    filter.segment = normalizedSegment;
  }

  if (normalizedTimeframe) {
    filter.timeframe = normalizedTimeframe;
  }

  if (excludeSignalId) {
    filter._id = { $ne: excludeSignalId };
  }

  const activeSignals = await Signal.find(filter).sort({ signalTime: -1, createdAt: -1, _id: -1 });
  const eligibleSignals = activeSignals.filter((candidate) => {
    const startedAt = getSignalStartDate(candidate);
    return startedAt instanceof Date && startedAt.getTime() < nextSignalTime.getTime();
  });

  const settledSignals = [];

  for (const candidate of eligibleSignals) {
    const status = inferSignalStatusFromExitPrice(candidate, nextEntryPrice);
    const totalPoints = resolveTotalPoints(candidate, nextEntryPrice);

    const updated = await updateSignalById(candidate.id, {
      status,
      exitPrice: nextEntryPrice,
      totalPoints,
      exitReason: 'AUTO_SETTLED_ON_OPPOSITE_ENTRY',
      exitTime: nextSignalTime,
      skipSideEffects,
    });

    settledSignals.push(updated);
  }

  return settledSignals;
};

const deleteSignalById = async (signalId) => {
  const signal = await Signal.findById(signalId);
  if (!signal) {
    throw new Error('Signal not found');
  }
  await signal.deleteOne();
  return signal;
};

export default {
  createSignal,
  querySignals,
  getSignalById,
  getSignalStats,
  getSignalPeriodStats,
  getSignalReport,
  updateSignalById,
  settleOppositeActiveSignalsForEntry,
  deleteSignalById,
};

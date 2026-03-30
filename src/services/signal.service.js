import Signal from '../models/Signal.js';
import MasterSymbol from '../models/MasterSymbol.js';
import announcementService from './announcement.service.js';
import logger from '../config/log.js';
import { broadcastToRoles } from './websocket.service.js';
import marketDataService from './marketData.service.js';
import { getSignalAudienceGroups } from '../utils/signalRouting.js';
import { resolveSymbolSegmentGroup } from '../utils/marketSegmentResolver.js';
import { normalizeSignalTimeframe } from '../utils/timeframe.js';
import { resolveBestMasterSymbol } from '../utils/masterSymbolResolver.js';
import { normalizeSignalTimestampInput } from '../utils/signalTimestamp.js';
import {
  addIndiaDays,
  getEndOfIndiaDay,
  getStartOfIndiaDay,
  getStartOfIndiaMonth,
  getStartOfIndiaWeek,
} from '../utils/indiaTime.js';

const CLOSED_SIGNAL_STATUSES = ['Closed', 'Target Hit', 'Partial Profit Book', 'Stoploss Hit'];
const OPEN_SIGNAL_STATUSES = ['Active', 'Open', 'Paused'];
const SIGNAL_DERIVED_DATES = {
  timezone: 'Asia/Kolkata',
};
const TARGET_LEVEL_SEQUENCE = ['TP1', 'TP2', 'TP3'];
const TARGET_LEVEL_RANK = TARGET_LEVEL_SEQUENCE.reduce((accumulator, level, index) => {
  accumulator[level] = index + 1;
  return accumulator;
}, {});

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
const getSignalDirection = (signal) => String(signal?.type || 'BUY').trim().toUpperCase();
const isSellSignal = (signal) => getSignalDirection(signal) === 'SELL';
const normalizeSignalTargetLevel = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  return TARGET_LEVEL_RANK[normalized] ? normalized : null;
};

const getHigherSignalTargetLevel = (left, right) => {
  const normalizedLeft = normalizeSignalTargetLevel(left);
  const normalizedRight = normalizeSignalTargetLevel(right);

  if (!normalizedLeft) return normalizedRight;
  if (!normalizedRight) return normalizedLeft;

  return TARGET_LEVEL_RANK[normalizedRight] > TARGET_LEVEL_RANK[normalizedLeft]
    ? normalizedRight
    : normalizedLeft;
};

const getSignalTargets = (signal) => {
  const target1 = toFiniteNumber(signal?.targets?.target1);
  const target2 = toFiniteNumber(signal?.targets?.target2);
  const target3 = toFiniteNumber(signal?.targets?.target3);

  return [
    typeof target1 === 'number' ? { level: 'TP1', price: target1 } : null,
    typeof target2 === 'number' ? { level: 'TP2', price: target2 } : null,
    typeof target3 === 'number' ? { level: 'TP3', price: target3 } : null,
  ].filter(Boolean);
};

const getFinalSignalTarget = (signal) => {
  const targets = getSignalTargets(signal);
  return targets.length > 0 ? targets[targets.length - 1] : null;
};

const isSignalPriceReached = ({ signal, thresholdPrice, marketPrice }) => {
  const threshold = toFiniteNumber(thresholdPrice);
  const price = toFiniteNumber(marketPrice);
  if (typeof threshold !== 'number' || typeof price !== 'number') return false;

  const roundedThreshold = roundSignalValue(threshold);
  const roundedPrice = roundSignalValue(price);
  return isSellSignal(signal) ? roundedPrice <= roundedThreshold : roundedPrice >= roundedThreshold;
};

const getSignalHighestAchievedTargetLevel = (signal, marketPrice) => {
  const targets = getSignalTargets(signal);
  if (targets.length === 0) return null;

  let highestLevel = null;
  targets.forEach((target) => {
    if (isSignalPriceReached({ signal, thresholdPrice: target.price, marketPrice })) {
      highestLevel = target.level;
    }
  });

  return highestLevel;
};

const hasSignalReachedStopLoss = (signal, marketPrice) => {
  const stopLoss = toFiniteNumber(signal?.stopLoss);
  return isSignalPriceReached({
    signal: { ...signal, type: isSellSignal(signal) ? 'BUY' : 'SELL' },
    thresholdPrice: stopLoss,
    marketPrice,
  });
};

const resolveOutcomeTargetLevel = (signal, priceCandidate) =>
  getSignalHighestAchievedTargetLevel(signal, priceCandidate) || getFinalSignalTarget(signal)?.level || 'TP1';

const buildAutoSignalSettlement = (signal, marketPrice, options = {}) => {
  const currentStatus = String(signal?.status || '').trim();
  if (!OPEN_SIGNAL_STATUSES.includes(currentStatus)) return null;

  const resolvedPrice = toFiniteNumber(marketPrice);
  if (typeof resolvedPrice !== 'number' || resolvedPrice <= 0) return null;

  const occurredAt = normalizeSignalTimestampInput(options.occurredAt) || new Date();
  const finalTarget = getFinalSignalTarget(signal);
  const highestTargetLevel = getSignalHighestAchievedTargetLevel(signal, resolvedPrice);

  if (hasSignalReachedStopLoss(signal, resolvedPrice)) {
    const stopLoss = toFiniteNumber(signal?.stopLoss);
    if (typeof stopLoss !== 'number') return null;

    return {
      status: 'Stoploss Hit',
      exitPrice: stopLoss,
      exitReason: options.exitReason || 'AUTO_STOPLOSS_REACHED',
      exitTime: occurredAt,
      ...(options.notes !== undefined ? { notes: options.notes } : {}),
      notificationMeta: {
        subType: 'SIGNAL_STOPLOSS',
        data: {
          currentPrice: resolvedPrice,
          updateMessage:
            options.updateMessage || `Auto-closed after live price reached stop loss on ${signal.symbol}.`,
        },
      },
    };
  }

  if (finalTarget && highestTargetLevel === finalTarget.level) {
    return {
      status: 'Target Hit',
      exitPrice: finalTarget.price,
      exitReason: options.exitReason || `AUTO_TARGET_REACHED_${finalTarget.level}`,
      exitTime: occurredAt,
      ...(options.notes !== undefined ? { notes: options.notes } : {}),
      notificationMeta: {
        subType: 'SIGNAL_TARGET',
        data: {
          targetLevel: finalTarget.level,
          currentPrice: resolvedPrice,
          updateMessage:
            options.updateMessage || `Auto-closed after live price reached ${finalTarget.level} on ${signal.symbol}.`,
        },
      },
    };
  }

  return null;
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

const resolveExitPriceFromStatus = (signal, nextStatus) => {
  const status = String(nextStatus || signal?.status || '').trim().toLowerCase();
  const entry = toFiniteNumber(signal?.entryPrice);
  const stopLoss = toFiniteNumber(signal?.stopLoss);
  const t1 = toFiniteNumber(signal?.targets?.target1);
  const t2 = toFiniteNumber(signal?.targets?.target2);
  const t3 = toFiniteNumber(signal?.targets?.target3);

  if (status.includes('stop') && typeof stopLoss === 'number') return stopLoss;
  if (status.includes('target')) {
    if (typeof t3 === 'number') return t3;
    if (typeof t2 === 'number') return t2;
    if (typeof t1 === 'number') return t1;
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

const getLifecycleSignalStartDate = (signal = {}) => {
  const parsedSignalTime = normalizeSignalTimestampInput(signal?.signalTime);
  if (parsedSignalTime instanceof Date && !Number.isNaN(parsedSignalTime.getTime())) {
    return parsedSignalTime;
  }

  const parsedCreatedAt = normalizeSignalTimestampInput(signal?.createdAt);
  if (parsedCreatedAt instanceof Date && !Number.isNaN(parsedCreatedAt.getTime())) {
    return parsedCreatedAt;
  }

  return null;
};

const resolveChronologicalExitTime = (signal = {}, candidateExitTime = null) => {
  const startAt = getLifecycleSignalStartDate(signal);
  const parsedExitTime = normalizeSignalTimestampInput(candidateExitTime);
  if (!(parsedExitTime instanceof Date) || Number.isNaN(parsedExitTime.getTime())) {
    if (startAt instanceof Date) {
      return new Date(Math.max(Date.now(), startAt.getTime() + 1000));
    }

    return new Date();
  }

  if (!(startAt instanceof Date)) {
    return parsedExitTime;
  }

  if (parsedExitTime.getTime() >= startAt.getTime()) {
    return parsedExitTime;
  }

  return new Date(startAt.getTime() + 1000);
};

const inferSignalStatusFromExitPrice = (signal, exitPrice) => {
  const resolvedExitPrice = toFiniteNumber(exitPrice);
  const entryPrice = toFiniteNumber(signal?.entryPrice);
  const stopLoss = toFiniteNumber(signal?.stopLoss);
  const highestTargetLevel = getSignalHighestAchievedTargetLevel(signal, resolvedExitPrice);
  const finalTargetLevel = getFinalSignalTarget(signal)?.level || null;

  if (typeof resolvedExitPrice !== 'number' || typeof entryPrice !== 'number') {
    return 'Closed';
  }

  if (highestTargetLevel && finalTargetLevel && highestTargetLevel === finalTargetLevel) {
    return 'Target Hit';
  }

  if (typeof stopLoss === 'number') {
    const stopReached = hasSignalReachedStopLoss(signal, resolvedExitPrice);
    if (stopReached) return 'Stoploss Hit';
  }

  if (highestTargetLevel) {
    return 'Partial Profit Book';
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
      const resolvedOutcomeTargetLevel = resolveOutcomeTargetLevel(
        signal,
        notificationMeta?.data?.currentPrice ?? notificationData.exitPrice ?? signal.exitPrice
      );

      if (notificationMeta?.subType) {
        subType = notificationMeta.subType;
        Object.assign(notificationData, notificationMeta.data || {});
        if (subType === 'SIGNAL_TARGET' && !notificationData.targetLevel) {
          notificationData.targetLevel = resolvedOutcomeTargetLevel;
        }
        if (!notificationData.updateMessage && updateBody.notes) {
          notificationData.updateMessage = updateBody.notes;
        }
      } else if (updateBody.status === 'Target Hit') {
        subType = 'SIGNAL_TARGET';
        notificationData.targetLevel = resolvedOutcomeTargetLevel;
        notificationData.currentPrice = signal.exitPrice ?? signal.entryPrice;
      } else if (updateBody.status === 'Partial Profit Book') {
        subType = 'SIGNAL_PARTIAL_PROFIT';
        notificationData.targetLevel = resolvedOutcomeTargetLevel;
        notificationData.currentPrice = signal.exitPrice ?? signal.entryPrice;
      } else if (updateBody.status === 'Stoploss Hit') {
        subType = 'SIGNAL_STOPLOSS';
        notificationData.currentPrice = signal.exitPrice ?? signal.stopLoss ?? signal.entryPrice;
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

const buildTradingViewSignalFilter = () => ({
  $or: [
    { source: 'TRADINGVIEW' },
    {
      source: { $exists: false },
      $or: [
        { webhookId: { $exists: true, $ne: '' } },
        { uniqueId: { $regex: /^ENTRY\|/i } },
      ],
    },
  ],
});

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

const signalCreationGuardCleanupTimer = setInterval(() => {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  for (const [key, timestamp] of signalCreationGuard.entries()) {
    if (timestamp < fiveMinutesAgo) {
      signalCreationGuard.delete(key);
    }
  }
}, 5 * 60 * 1000);

if (typeof signalCreationGuardCleanupTimer.unref === 'function') {
  signalCreationGuardCleanupTimer.unref();
}

const createSignal = async (signalBody, user) => {
  if (signalBody.timeframe !== undefined) {
    const normalizedTimeframe = normalizeSignalTimeframe(signalBody.timeframe);
    signalBody.timeframe = normalizedTimeframe || signalBody.timeframe;
  }
  if (!signalBody.signalTime) {
    signalBody.signalTime = new Date();
  }
  normalizePersistedSignalDates(signalBody);
  signalBody.source = String(signalBody?.source || (user ? 'MANUAL' : 'SYSTEM')).trim().toUpperCase();

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
                    '|',
                    { $ifNull: ['$type', ''] },
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
  const startOfToday = getStartOfIndiaDay(now);
  const startOfWeek = getStartOfIndiaWeek(now);
  const startOfMonth = getStartOfIndiaMonth(now);
  const startOfTomorrow = addIndiaDays(startOfToday, 1);
  const endOfTomorrow = getEndOfIndiaDay(startOfTomorrow);

  const pipeline = [
    ...buildSignalDedupStages(filter),
    {
      $group: {
        _id: null,
        todaySignals: {
          $sum: {
            $cond: [{ $gte: ['$__eventTime', startOfToday] }, 1, 0],
          },
        },
        tomorrowSignals: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ['$__eventTime', startOfTomorrow] },
                  { $lte: ['$__eventTime', endOfTomorrow] },
                ],
              },
              1,
              0,
            ],
          },
        },
        weeklySignals: {
          $sum: {
            $cond: [{ $gte: ['$__eventTime', startOfWeek] }, 1, 0],
          },
        },
        monthlySignals: {
          $sum: {
            $cond: [{ $gte: ['$__eventTime', startOfMonth] }, 1, 0],
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

    signal.exitTime = resolveChronologicalExitTime(signal, signal.exitTime);
  }

  if (isReopeningToActive) {
    signal.exitPrice = undefined;
    signal.totalPoints = undefined;
    signal.exitReason = undefined;
    signal.exitTime = undefined;
  }

  await signal.save();
  if (persistedUpdateBody?.status && CLOSED_SIGNAL_STATUSES.includes(persistedUpdateBody.status)) {
    logger.info(
      `[SIGNAL_FLOW] settled signal=${signal.id} symbol=${signal.symbol} status=${signal.status} ` +
      `entry=${signal.entryPrice ?? 'NA'} exit=${signal.exitPrice ?? 'NA'} points=${signal.totalPoints ?? 'NA'} ` +
      `signalTime=${signal.signalTime ? new Date(signal.signalTime).toISOString() : 'NA'} ` +
      `exitTime=${signal.exitTime ? new Date(signal.exitTime).toISOString() : 'NA'} reason=${signal.exitReason || 'NA'}`
    );
  } else if (persistedUpdateBody?.status || persistedUpdateBody?.notes) {
    logger.info(
      `[SIGNAL_FLOW] updated signal=${signal.id} symbol=${signal.symbol} status=${signal.status} ` +
      `notesChanged=${persistedUpdateBody?.notes !== undefined ? 'yes' : 'no'}`
    );
  }
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

const reconcileSignalWithMarketPrice = async (signalOrId, marketPrice, options = {}) => {
  const signal =
    signalOrId && typeof signalOrId === 'object' && signalOrId._id
      ? signalOrId
      : await Signal.findById(signalOrId);

  if (!signal) return null;

  const settlementUpdate = buildAutoSignalSettlement(signal, marketPrice, options);
  if (!settlementUpdate) return null;

  return updateSignalById(signal.id, {
    ...settlementUpdate,
    skipSideEffects: options.skipSideEffects ?? false,
  });
};

const reconcileActiveSignalsWithMarketData = async (options = {}) => {
  const {
    signalIds = null,
    limit = 0,
    skipSideEffects = false,
    fetchLatestQuotes = true,
  } = options;

  const filter = {
    status: { $in: OPEN_SIGNAL_STATUSES },
  };

  if (Array.isArray(signalIds) && signalIds.length > 0) {
    filter._id = { $in: signalIds };
  }

  let query = Signal.find(filter).sort({ signalTime: -1, createdAt: -1, _id: -1 });
  if (Number.isFinite(limit) && limit > 0) {
    query = query.limit(limit);
  }

  const signals = await query;
  if (signals.length === 0) {
    return { scannedCount: 0, closedCount: 0, updatedSignals: [] };
  }

  const uniqueSymbols = Array.from(
    new Set(
      signals
        .map((signal) => String(signal?.symbol || '').trim())
        .filter(Boolean)
    )
  );

  if (fetchLatestQuotes && uniqueSymbols.length > 0) {
    try {
      await marketDataService.fetchQuoteBySymbols(uniqueSymbols);
    } catch (error) {
      logger.warn(`Failed fetching live quotes for active signal reconciliation: ${error.message}`);
    }
  }

  const updatedSignals = [];

  for (const signal of signals) {
    const livePrice = toFiniteNumber(marketDataService.getBestLivePrice(signal.symbol, null, 0));
    if (typeof livePrice !== 'number' || livePrice <= 0) continue;

    const updated = await reconcileSignalWithMarketPrice(signal, livePrice, {
      occurredAt: new Date(),
      skipSideEffects,
      updateMessage: `Auto-reconciled from live market price ${roundSignalValue(livePrice)}.`,
    });

    if (updated) {
      updatedSignals.push(updated);
    }
  }

  return {
    scannedCount: signals.length,
    closedCount: updatedSignals.length,
    updatedSignals,
  };
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
  buildTradingViewSignalFilter,
  createSignal,
  querySignals,
  getSignalById,
  getSignalStats,
  getSignalPeriodStats,
  getSignalReport,
  updateSignalById,
  settleOppositeActiveSignalsForEntry,
  buildAutoSignalSettlement,
  getFinalSignalTarget,
  getSignalHighestAchievedTargetLevel,
  hasSignalReachedStopLoss,
  reconcileSignalWithMarketPrice,
  reconcileActiveSignalsWithMarketData,
  deleteSignalById,
};

export {
  buildTradingViewSignalFilter,
  buildAutoSignalSettlement,
  getFinalSignalTarget,
  getSignalHighestAchievedTargetLevel,
  hasSignalReachedStopLoss,
  reconcileActiveSignalsWithMarketData,
  reconcileSignalWithMarketPrice,
};

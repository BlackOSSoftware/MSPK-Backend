import Signal from '../models/Signal.js';
import announcementService from './announcement.service.js';
import logger from '../config/log.js';
import { broadcastToRoles } from './websocket.service.js';
import { getSignalAudienceGroups } from '../utils/signalRouting.js';

const CLOSED_SIGNAL_STATUSES = ['Closed', 'Target Hit', 'Partial Profit Book', 'Stoploss Hit'];

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

const scheduleUpdateSideEffects = (signal, updateBody, signalId) => {
  if (!updateBody.status && !updateBody.notes) return;

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

      if (updateBody.status === 'Target Hit') {
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
  if (signalBody.uniqueId) {
    signalBody.uniqueId = String(signalBody.uniqueId).trim();
    const existing = await Signal.findOne({ uniqueId: signalBody.uniqueId });
    if (existing) return existing;
  }

  const normalizedSymbol = signalBody.symbol?.toUpperCase().trim();
  const normalizedPrice = Math.round(parseFloat(signalBody.entryPrice) * 100) / 100;
  const dedupKey = signalBody.uniqueId
    ? `UID_${signalBody.uniqueId}`
    : `${normalizedSymbol}_${signalBody.type}_${normalizedPrice}`;
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

const querySignals = async (filter, options) => {
  const page = options.page ? parseInt(options.page) : 1;
  const limit = options.limit ? parseInt(options.limit) : 10;
  const skip = (page - 1) * limit;

  const [totalResults, results] = await Promise.all([
    Signal.countDocuments(filter),
    Signal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);

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
  const pipeline = [];
  if (filter && Object.keys(filter).length > 0) {
    pipeline.push({ $match: filter });
  }

  pipeline.push({
    $group: {
      _id: null,
      totalSignals: { $sum: 1 },
      activeSignals: {
        $sum: {
          $cond: [{ $in: ['$status', ['Open', 'Active', 'Paused']] }, 1, 0],
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
  });

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

const updateSignalById = async (signalId, updateBody) => {
  const signal = await Signal.findById(signalId);
  if (!signal) {
    throw new Error('Signal not found');
  }

  if ((updateBody.symbol || updateBody.segment) && !updateBody.category) {
    const merged = { ...signal.toObject(), ...updateBody };
    updateBody.category = mapSignalToCategory(merged);
  } else if (!signal.category && !updateBody.category) {
    updateBody.category = mapSignalToCategory(signal);
  }

  Object.assign(signal, updateBody);

  if (updateBody?.status && CLOSED_SIGNAL_STATUSES.includes(updateBody.status)) {
    if (signal.exitPrice === undefined || signal.exitPrice === null) {
      const exitPrice = resolveExitPriceFromStatus(signal, updateBody.status);
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

  await signal.save();
  scheduleUpdateSideEffects(signal, updateBody, signalId);
  return signal;
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
  updateSignalById,
  deleteSignalById,
};

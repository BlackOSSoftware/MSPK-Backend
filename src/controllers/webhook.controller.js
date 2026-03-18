import httpStatus from 'http-status';
import mongoose from 'mongoose';
import Signal from '../models/Signal.js';
import catchAsync from '../utils/catchAsync.js';
import logger from '../config/log.js';
import { signalService } from '../services/index.js';
import { connectRedis, redisClient } from '../services/redis.service.js';
import {
  buildWebhookSignalId,
  normalizeSignalSegment,
  normalizeSignalSymbol,
} from '../utils/signalRouting.js';
import { resolveBestMasterSymbol } from '../utils/masterSymbolResolver.js';
import { buildTimeframeQuery, getTimeframeDurationMs, normalizeSignalTimeframe } from '../utils/timeframe.js';

const parseBoolean = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value !== 'string') return undefined;

  const v = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  return undefined;
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
const MIN_STALE_ENTRY_SIGNAL_AGE_MS = 90 * 60 * 1000;
const MAX_STALE_ENTRY_SIGNAL_AGE_MS = 48 * 60 * 60 * 1000;
const ABSOLUTE_MAX_ENTRY_SIGNAL_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const PROCESSED_ENTRY_SIGNAL_TTL_SECONDS = 30 * 24 * 60 * 60;

const getSignalClosedStatuses = () => ['Closed', 'Target Hit', 'Partial Profit Book', 'Stoploss Hit'];

const resolveInfoTargetLevel = (message) => {
  const normalized = String(message || '').trim().toUpperCase();
  if (!normalized) return null;
  if (normalized.includes('T1') || normalized.includes('TP1')) return 'TP1';
  if (normalized.includes('T2') || normalized.includes('TP2')) return 'TP2';
  if (normalized.includes('T3') || normalized.includes('TP3')) return 'TP3';
  return null;
};

const buildInfoUpdateMessage = ({ message, targetLevel, price, time }) => {
  const normalizedMessage = String(message || '').trim().toUpperCase();
  const label = targetLevel || normalizedMessage.replace(/_/g, ' ') || 'INFO';
  const parts = [`${label} achieved`];

  if (typeof price === 'number') {
    parts.push(`at ${roundSignalValue(price)}`);
  }
  if (time) {
    parts.push(`on ${new Date(time).toISOString()}`);
  }

  return `${parts.join(' ')}. Trade remains active.`;
};

const deriveExitPoints = ({ signal, exitPrice, totalPoints }) => {
  const resolvedTotalPoints = toFiniteNumber(totalPoints);
  const entryPrice = toFiniteNumber(signal?.entryPrice);
  const resolvedExitPrice = toFiniteNumber(exitPrice);
  const signalType = String(signal?.type || 'BUY').trim().toUpperCase();
  const derivedPoints =
    typeof entryPrice === 'number' && typeof resolvedExitPrice === 'number'
      ? roundSignalValue(signalType === 'SELL' ? entryPrice - resolvedExitPrice : resolvedExitPrice - entryPrice)
      : undefined;

  if (
    typeof resolvedTotalPoints === 'number' &&
    (Math.abs(resolvedTotalPoints) > 0 || typeof derivedPoints !== 'number')
  ) {
    return roundSignalValue(resolvedTotalPoints);
  }

  return derivedPoints;
};

const deriveExitStatus = ({ signal, exitReason, exitPrice, totalPoints }) => {
  const reason = String(exitReason || '').trim().toUpperCase();
  const points = deriveExitPoints({ signal, exitPrice, totalPoints });

  if (reason.includes('PARTIAL') || reason.includes('PROFIT')) {
    return 'Partial Profit Book';
  }

  if (reason.includes('TARGET')) {
    return 'Target Hit';
  }

  if (reason.includes('STOP') || reason.includes('SL')) {
    if (typeof points === 'number' && points > 0) {
      return 'Partial Profit Book';
    }

    return 'Stoploss Hit';
  }

  if (typeof points === 'number' && points > 0) {
    return 'Partial Profit Book';
  }

  return 'Closed';
};

const getWebhookSymbolInput = (body = {}) =>
  String(
    body.symbol_id ||
      body.symbolId ||
      body.master_symbol_id ||
      body.masterSymbolId ||
      body.symbol ||
      ''
  ).trim();

const looksLikeMasterSymbolId = (value) => /-[a-f0-9]{24}$/i.test(String(value || '').trim());

const parseWebhookDate = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const getAllowedSignalAgeMs = (timeframe) => {
  const timeframeMs = getTimeframeDurationMs(timeframe);
  if (!timeframeMs) return MIN_STALE_ENTRY_SIGNAL_AGE_MS;

  return Math.min(Math.max(timeframeMs * 4, MIN_STALE_ENTRY_SIGNAL_AGE_MS), MAX_STALE_ENTRY_SIGNAL_AGE_MS);
};

const buildProcessedEntrySignalKey = (uniqueId = '') => {
  const normalized = String(uniqueId || '').trim();
  if (!normalized) return '';
  return `processed_signal_entry:${normalized}`;
};

const hasProcessedEntrySignal = async (uniqueId = '') => {
  const cacheKey = buildProcessedEntrySignalKey(uniqueId);
  if (!cacheKey) return false;

  try {
    const redisReady = await connectRedis();
    if (!redisReady) return false;
    const value = await redisClient.get(cacheKey);
    return Boolean(value);
  } catch (error) {
    logger.warn(`[WEBHOOK] Failed to check processed entry cache for ${uniqueId}: ${error.message}`);
    return false;
  }
};

const rememberProcessedEntrySignal = async (uniqueId = '') => {
  const cacheKey = buildProcessedEntrySignalKey(uniqueId);
  if (!cacheKey) return;

  try {
    const redisReady = await connectRedis();
    if (!redisReady) return;
    await redisClient.set(cacheKey, '1', 'EX', PROCESSED_ENTRY_SIGNAL_TTL_SECONDS);
  } catch (error) {
    logger.warn(`[WEBHOOK] Failed to persist processed entry cache for ${uniqueId}: ${error.message}`);
  }
};

const resolveMasterSymbol = async (input, { symbolIdRequested = false } = {}) => {
  return resolveBestMasterSymbol(input, { symbolIdRequested });
};

const receiveSignal = catchAsync(async (req, res) => {
  const startedAt = Date.now();
  const event = String(req.body.event || '').trim().toUpperCase();
  const webhookId = String(
    req.body.uniq_id || req.body.unique_id || req.body.uniqueId || req.body.uniqe_id || ''
  ).trim();
  const symbolInput = getWebhookSymbolInput(req.body);
  const symbolIdRequested =
    Boolean(req.body.symbol_id || req.body.symbolId || req.body.master_symbol_id || req.body.masterSymbolId) ||
    looksLikeMasterSymbolId(symbolInput);
  const resolvedMasterSymbol = await resolveMasterSymbol(symbolInput, { symbolIdRequested });
  const symbol = resolvedMasterSymbol
    ? normalizeSignalSymbol(resolvedMasterSymbol.symbol)
    : normalizeSignalSymbol(req.body.symbol || symbolInput);
  const segment = resolvedMasterSymbol
    ? normalizeSignalSegment(resolvedMasterSymbol.segment, resolvedMasterSymbol.symbol)
    : normalizeSignalSegment(req.body.segment, symbol);
  const isFreeFromPayload = parseBoolean(req.body.is_free ?? req.body.isFree ?? req.body.free);
  const isFree = isFreeFromPayload ?? false;
  const normalizedTimeframe = normalizeSignalTimeframe(req.body.timeframe);
  const isEntryEvent = !['INFO', 'EXIT'].includes(event);
  const parsedSignalTime = parseWebhookDate(req.body.signal_time);
  const signalAgeMs =
    isEntryEvent && parsedSignalTime ? Date.now() - parsedSignalTime.getTime() : null;
  const allowedSignalAgeMs =
    isEntryEvent && parsedSignalTime ? getAllowedSignalAgeMs(normalizedTimeframe) : null;
  const isUnexpectedlyOldEntry =
    typeof signalAgeMs === 'number' &&
    typeof allowedSignalAgeMs === 'number' &&
    signalAgeMs > allowedSignalAgeMs;
  const isAbsurdlyOldEntry =
    typeof signalAgeMs === 'number' &&
    signalAgeMs > ABSOLUTE_MAX_ENTRY_SIGNAL_AGE_MS;

  const sendWebhookResponse = (status, payload) => {
    logger.info(
      `[WEBHOOK] ${event || 'ENTRY'} ${symbol || symbolInput || 'unknown'} responded in ${Date.now() - startedAt}ms`
    );
    return res.status(status).send(payload);
  };

  if (symbolIdRequested && symbolInput && !resolvedMasterSymbol) {
    return sendWebhookResponse(httpStatus.BAD_REQUEST, {
      message: 'Provided symbol ID does not match any master symbol.',
      symbolId: symbolInput,
    });
  }

  if (!symbol || !segment) {
    return sendWebhookResponse(httpStatus.BAD_REQUEST, {
      message: 'Valid symbol and segment are required to process webhook.',
      symbol: symbolInput || req.body.symbol || '',
    });
  }

  const findSignalByWebhookId = async (webhookId) => {
    if (!webhookId) return { signal: null, ambiguous: false };
    const id = String(webhookId).trim();
    const baseFilter = symbol ? { symbol, segment } : { segment };
    const timeframeFilter = buildTimeframeQuery('timeframe', normalizedTimeframe);
    const buildScopedFilters = (filter) =>
      timeframeFilter ? [{ ...filter, ...timeframeFilter }] : [filter];
    const dedupeSignals = (signals = []) => {
      const uniqueSignals = new Map();
      signals.forEach((candidate) => {
        if (!candidate?._id) return;
        uniqueSignals.set(String(candidate._id), candidate);
      });
      return Array.from(uniqueSignals.values());
    };
    const sortCandidates = (signals = []) =>
      [...signals].sort((left, right) => {
        const leftUpdated = new Date(left?.updatedAt || left?.createdAt || 0).getTime();
        const rightUpdated = new Date(right?.updatedAt || right?.createdAt || 0).getTime();
        return rightUpdated - leftUpdated;
      });
    const resolveCandidateResult = (signals = []) => {
      const candidates = sortCandidates(dedupeSignals(signals));
      if (candidates.length === 0) {
        return { signal: null, ambiguous: false };
      }

      if (timeframeFilter) {
        return { signal: candidates[0], ambiguous: false };
      }

      const distinctTimeframes = new Set(
        candidates
          .map((candidate) => normalizeSignalTimeframe(candidate?.timeframe) || String(candidate?.timeframe || '').trim())
          .filter(Boolean)
      );

      if (distinctTimeframes.size > 1) {
        logger.warn(
          `[WEBHOOK] Ambiguous signal match for ${symbol || 'unknown'} webhookId=${id}. Multiple timeframes active; include timeframe in webhook EXIT/INFO payload.`
        );
        return { signal: null, ambiguous: true };
      }

      return { signal: candidates[0], ambiguous: false };
    };
    const collectCandidates = async ({ includeClosed = false } = {}) => {
      const scopedFilters = buildScopedFilters(baseFilter);
      const statusFilter = includeClosed ? {} : { status: { $nin: getSignalClosedStatuses() } };
      const queries = scopedFilters.map((scopedFilter) =>
        Signal.find({
          ...scopedFilter,
          ...statusFilter,
          $or: [{ uniqueId: id }, { webhookId: id }],
        })
          .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
          .limit(5)
      );

      if (symbol) {
        buildScopedFilters({ symbol }).forEach((scopedFilter) => {
          queries.push(
            Signal.find({
              ...scopedFilter,
              ...statusFilter,
              $or: [{ uniqueId: id }, { webhookId: id }],
            })
              .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
              .limit(5)
          );
        });
      }

      const queryResults = await Promise.all(queries);
      return queryResults.flat();
    };

    // 1) If webhook sends our MongoDB _id
    if (mongoose.Types.ObjectId.isValid(id)) {
      const byId = await Signal.findById(id);
      if (byId) return { signal: byId, ambiguous: false };
    }

    // 2) Match by the caller-provided ID first.
    const activeMatchResult = resolveCandidateResult(await collectCandidates());
    if (activeMatchResult.signal || activeMatchResult.ambiguous || !req.body.exit_time) {
      return activeMatchResult;
    }

    // 3) If already closed (idempotent EXIT), match on exit_time too.
    if (req.body.exit_time) {
      const exitTime = new Date(req.body.exit_time);
      const closedCandidates = (await collectCandidates({ includeClosed: true })).filter((candidate) => {
        const candidateExitTime = candidate?.exitTime ? new Date(candidate.exitTime).getTime() : NaN;
        return Number.isFinite(candidateExitTime) && candidateExitTime === exitTime.getTime();
      });
      return resolveCandidateResult(closedCandidates);
    }

    return { signal: null, ambiguous: false };
  };

  if (event === 'INFO') {
    const { signal: existing, ambiguous } = await findSignalByWebhookId(webhookId);
    if (ambiguous) {
      return sendWebhookResponse(httpStatus.OK, {
        status: 'ambiguous_timeframe',
        uniq_id: webhookId,
        symbol,
        timeframe: normalizedTimeframe || null,
      });
    }
    if (!existing) {
      return sendWebhookResponse(httpStatus.OK, {
        status: 'not_found',
        uniq_id: webhookId,
        symbol,
        timeframe: normalizedTimeframe || null,
      });
    }

    const currentPrice = toFiniteNumber(req.body.price);
    const infoTime = req.body.time;
    const targetLevel = resolveInfoTargetLevel(req.body.message);
    const noteText = buildInfoUpdateMessage({
      message: req.body.message,
      targetLevel,
      price: currentPrice,
      time: infoTime,
    });

    if (existing.notes === noteText) {
      return sendWebhookResponse(httpStatus.OK, {
        status: 'ok',
        signal: existing,
        info: { targetLevel, message: req.body.message },
      });
    }

    const updated = await signalService.updateSignalById(existing.id, {
      notes: noteText,
      notificationMeta: {
        subType: 'SIGNAL_INFO',
        data: {
          targetLevel: targetLevel || 'INFO',
          currentPrice,
          updateMessage: noteText,
          messageCode: String(req.body.message || '').trim().toUpperCase(),
          infoTime,
        },
      },
    });

    return sendWebhookResponse(httpStatus.OK, {
      status: 'ok',
      signal: updated,
      info: { targetLevel, message: req.body.message },
    });
  }

  if (event === 'EXIT') {
    const { signal: existing, ambiguous } = await findSignalByWebhookId(webhookId);
    if (ambiguous) {
      return sendWebhookResponse(httpStatus.OK, {
        status: 'ambiguous_timeframe',
        uniq_id: webhookId,
        symbol,
        timeframe: normalizedTimeframe || null,
      });
    }
    if (!existing) {
      return sendWebhookResponse(httpStatus.OK, {
        status: 'not_found',
        uniq_id: webhookId,
        symbol,
        timeframe: normalizedTimeframe || null,
      });
    }

    const desiredStatus = deriveExitStatus({
      signal: existing,
      exitReason: req.body.exit_reason,
      exitPrice: req.body.exit_price,
      totalPoints: req.body.total_points,
    });
    const incomingExitTime = new Date(req.body.exit_time);
    const incomingExitPrice = toFiniteNumber(req.body.exit_price);
    const resolvedTotalPoints = deriveExitPoints({
      signal: existing,
      exitPrice: incomingExitPrice,
      totalPoints: req.body.total_points,
    });
    const isNumberClose = (a, b, eps = 1e-6) => {
      if (typeof a !== 'number' || typeof b !== 'number') return false;
      return Math.abs(a - b) <= eps;
    };

    const resolvedExitReason = desiredStatus === 'Partial Profit Book' ? 'Partial Profit Book' : req.body.exit_reason;

    const alreadyApplied =
      existing.exitTime &&
      existing.status === desiredStatus &&
      existing.exitReason === resolvedExitReason &&
      isNumberClose(existing.exitPrice, incomingExitPrice) &&
      isNumberClose(existing.totalPoints, resolvedTotalPoints) &&
      new Date(existing.exitTime).getTime() === incomingExitTime.getTime();

    if (alreadyApplied) {
      return sendWebhookResponse(httpStatus.OK, { status: 'ok', signal: existing });
    }

    const updateBody = {
      exitPrice: incomingExitPrice,
      totalPoints: resolvedTotalPoints,
      exitReason: resolvedExitReason,
      exitTime: req.body.exit_time,
      status: desiredStatus,
    };

    const updated = await signalService.updateSignalById(existing.id, updateBody);
    return sendWebhookResponse(httpStatus.OK, { status: 'ok', signal: updated });
  }

  const normalizedType = String(req.body.trade_type || '').trim().toUpperCase();

  const signalBody = {
    uniqueId: buildWebhookSignalId({
      webhookId,
      symbol,
      segment,
      tradeType: normalizedType,
      timeframe: normalizedTimeframe,
      entryPrice: req.body.entry_price,
      signalTime: req.body.signal_time,
    }),
    webhookId: webhookId || undefined,
    symbol,
    segment,
    type: normalizedType,
    timeframe: normalizedTimeframe,
    entryPrice: req.body.entry_price,
    stopLoss: req.body.stop_loss,
    targets: {
      target1: req.body.targets?.t1,
      target2: req.body.targets?.t2,
      target3: req.body.targets?.t3,
    },
    signalTime: req.body.signal_time,
    isFree,
    status: 'Active',
  };
  const processedEntryAlreadySeen = await hasProcessedEntrySignal(signalBody.uniqueId);

  // Upsert behavior for ENTRY webhooks: if the same `uniqueId` arrives again with updated fields,
  // update the existing signal instead of returning stale data.
  const existingByUniqueId = await Signal.findOne({ uniqueId: signalBody.uniqueId }).sort({ createdAt: -1 });
  if (existingByUniqueId) {
    const updateBody = {
      webhookId: signalBody.webhookId,
      symbol: signalBody.symbol,
      segment: signalBody.segment,
      type: signalBody.type,
      timeframe: signalBody.timeframe,
      entryPrice: signalBody.entryPrice,
      stopLoss: signalBody.stopLoss,
      targets: signalBody.targets,
      signalTime: signalBody.signalTime,
      isFree: signalBody.isFree,
    };

    const existingStatus = String(existingByUniqueId.status || '').trim().toUpperCase();
    const isClosedSignal = ['CLOSED', 'TARGET HIT', 'PARTIAL PROFIT BOOK', 'STOPLOSS HIT'].includes(existingStatus);

    if (!isClosedSignal) {
      const updated = await signalService.updateSignalById(existingByUniqueId.id, updateBody);
      await rememberProcessedEntrySignal(signalBody.uniqueId);
      return sendWebhookResponse(httpStatus.OK, { status: 'ok', signal: updated, updatedExisting: true });
    }
  }

  if (processedEntryAlreadySeen) {
    logger.warn(
      `[WEBHOOK] Ignoring already processed ENTRY signal for ${symbol}. signalTime=${parsedSignalTime?.toISOString?.() || 'NA'} timeframe=${normalizedTimeframe || 'NA'} webhookId=${webhookId || 'NA'} uniqueId=${signalBody.uniqueId}`
    );
    return sendWebhookResponse(httpStatus.OK, {
      status: 'duplicate_processed',
      symbol,
      timeframe: normalizedTimeframe || null,
      signalTime: parsedSignalTime?.toISOString?.() || null,
      uniqueId: signalBody.uniqueId,
    });
  }

  if (isAbsurdlyOldEntry) {
    logger.warn(
      `[WEBHOOK] Ignoring very old ENTRY signal for ${symbol}. signalTime=${parsedSignalTime.toISOString()} ageMs=${signalAgeMs} timeframe=${normalizedTimeframe || 'NA'} webhookId=${webhookId || 'NA'} uniqueId=${signalBody.uniqueId}`
    );
    return sendWebhookResponse(httpStatus.OK, {
      status: 'stale_ignored',
      symbol,
      timeframe: normalizedTimeframe || null,
      signalTime: parsedSignalTime.toISOString(),
      uniqueId: signalBody.uniqueId,
    });
  }

  if (isUnexpectedlyOldEntry) {
    logger.warn(
      `[WEBHOOK] Accepting delayed first-time ENTRY signal for ${symbol}. signalTime=${parsedSignalTime.toISOString()} ageMs=${signalAgeMs} allowedAgeMs=${allowedSignalAgeMs} timeframe=${normalizedTimeframe || 'NA'} webhookId=${webhookId || 'NA'} uniqueId=${signalBody.uniqueId}`
    );
  }

  const created = await signalService.createSignal(signalBody, null);

  // signalService has an in-memory 5m dedup guard that can return null.
  if (!created) {
    const afterGuard = await Signal.findOne({ uniqueId: signalBody.uniqueId });
    if (afterGuard) {
      await rememberProcessedEntrySignal(signalBody.uniqueId);
    }
    return sendWebhookResponse(httpStatus.OK, { status: 'duplicate_blocked', signal: afterGuard || null });
  }

  await rememberProcessedEntrySignal(signalBody.uniqueId);
  return sendWebhookResponse(httpStatus.OK, { status: 'ok', signal: created });
});

export default {
  receiveSignal,
};

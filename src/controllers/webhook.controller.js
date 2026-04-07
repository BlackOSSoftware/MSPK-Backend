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
import { looksLikeMasterSymbolId } from '../utils/masterSymbolId.js';
import { resolveBestMasterSymbol } from '../utils/masterSymbolResolver.js';
import {
  buildTimeframeQuery,
  getTimeframeDurationMs,
  getWebhookTimeframeValue,
  normalizeSignalTimeframe,
} from '../utils/timeframe.js';
import { parseSignalTimestamp } from '../utils/signalTimestamp.js';
import { resolveExitedSignalType, selectWebhookSignalCandidate } from '../utils/webhookSignalMatcher.js';

const TRADINGVIEW_SIGNAL_SOURCE_FILTER = {
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
};

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
const DELAYED_FEED_MIN_STALE_ENTRY_SIGNAL_AGE_MS = 12 * 60 * 60 * 1000;
const IMMEDIATE_EXIT_GUARD_MS = 2 * 60 * 1000;
const SIMULTANEOUS_EXIT_GUARD_MS = 45 * 1000;

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

  return `${parts.join(' ')}. Trade remains active.`;
};

const getSignalTargetValue = (signal, targetLevel) => {
  const targets = signal?.targets;
  if (!targets || !targetLevel) return undefined;

  if (targetLevel === 'TP1') {
    return toFiniteNumber(targets?.target1 ?? targets?.t1);
  }
  if (targetLevel === 'TP2') {
    return toFiniteNumber(targets?.target2 ?? targets?.t2);
  }
  if (targetLevel === 'TP3') {
    return toFiniteNumber(targets?.target3 ?? targets?.t3);
  }

  return undefined;
};

const isValidInfoTargetProgress = ({ signal, targetLevel, price }) => {
  if (!signal || !targetLevel || typeof price !== 'number') return true;

  const targetValue = getSignalTargetValue(signal, targetLevel);
  if (typeof targetValue !== 'number') return true;

  const signalType = String(signal?.type || '').trim().toUpperCase();
  const roundedPrice = roundSignalValue(price);
  const roundedTarget = roundSignalValue(targetValue);

  if (signalType === 'SELL') {
    return roundedPrice <= roundedTarget;
  }

  if (signalType === 'BUY') {
    return roundedPrice >= roundedTarget;
  }

  return true;
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
  const highestTargetLevel = signalService.getSignalHighestAchievedTargetLevel(signal, exitPrice);
  const finalTargetLevel = signalService.getFinalSignalTarget(signal)?.level || null;
  const reachedFinalTarget =
    Boolean(highestTargetLevel) && Boolean(finalTargetLevel) && highestTargetLevel === finalTargetLevel;

  if (reason.includes('PARTIAL') || reason.includes('PROFIT')) {
    return 'Partial Profit Book';
  }

  if (reason.includes('TARGET')) {
    if (highestTargetLevel && !reachedFinalTarget) {
      return 'Partial Profit Book';
    }
    return 'Target Hit';
  }

  if (reason.includes('STOP') || reason.includes('SL')) {
    if (typeof points === 'number' && points > 0) {
      return 'Partial Profit Book';
    }

    return 'Stoploss Hit';
  }

  if (reachedFinalTarget) {
    return 'Target Hit';
  }

  if (highestTargetLevel) {
    return 'Partial Profit Book';
  }

  if (typeof points === 'number' && points > 0) {
    return 'Partial Profit Book';
  }

  return 'Closed';
};

const assessExitSettlementCandidate = ({
  signal,
  exitReason,
  exitPrice,
  totalPoints,
  parsedExitTime,
  receivedAt = new Date(),
  timeframeFromPayload = '',
} = {}) => {
  const normalizedExitUpdate = normalizeExitWebhookPayload({
    signal,
    exitReason,
    exitPrice,
    totalPoints,
    exitTime: parsedExitTime || null,
    receivedAt,
    timeframeFromPayload,
  });

  const resolvedExitPrice = normalizedExitUpdate.exitPrice;
  const signalReferenceTime = getSignalReferenceTime(signal);
  const rawExitTime =
    parsedExitTime instanceof Date && !Number.isNaN(parsedExitTime.getTime()) ? parsedExitTime : null;
  const normalizedExitReason = String(exitReason || '').trim().toUpperCase();
  const rawExitPrice = toFiniteNumber(exitPrice);
  const isStopReason = /(STOP|SL)/.test(normalizedExitReason);
  const highestTargetLevel = signalService.getSignalHighestAchievedTargetLevel(signal, resolvedExitPrice);
  const finalTargetLevel = signalService.getFinalSignalTarget(signal)?.level || null;
  const reachedFinalTarget =
    Boolean(highestTargetLevel) && Boolean(finalTargetLevel) && highestTargetLevel === finalTargetLevel;
  const stopLossReached = signalService.hasSignalReachedStopLoss(signal, resolvedExitPrice);
  const rawStopLossReached =
    typeof rawExitPrice === 'number' ? signalService.hasSignalReachedStopLoss(signal, rawExitPrice) : false;
  const isOutOfSequence =
    rawExitTime instanceof Date &&
    signalReferenceTime instanceof Date &&
    rawExitTime.getTime() < signalReferenceTime.getTime();
  const isRealtimeSimultaneousExit =
    rawExitTime instanceof Date &&
    signalReferenceTime instanceof Date &&
    rawExitTime.getTime() - signalReferenceTime.getTime() <= SIMULTANEOUS_EXIT_GUARD_MS &&
    receivedAt instanceof Date &&
    !Number.isNaN(receivedAt.getTime()) &&
    receivedAt.getTime() - signalReferenceTime.getTime() <= IMMEDIATE_EXIT_GUARD_MS;
  const isImmediateNearEntryWithoutExecution =
    rawExitTime instanceof Date &&
    signalReferenceTime instanceof Date &&
    rawExitTime.getTime() - signalReferenceTime.getTime() <= IMMEDIATE_EXIT_GUARD_MS &&
    !highestTargetLevel &&
    !stopLossReached;

  if (isOutOfSequence) {
    return {
      accepted: false,
      rejectionCode: 'ignored_out_of_sequence_exit',
      rejectionMessage: 'EXIT arrived before ENTRY timestamp.',
      normalizedExitUpdate,
      highestTargetLevel,
      stopLossReached,
    };
  }

  if (isImmediateNearEntryWithoutExecution) {
    return {
      accepted: false,
      rejectionCode: 'ignored_immediate_exit_without_execution',
      rejectionMessage: 'EXIT arrived too close to ENTRY without TP/SL confirmation.',
      normalizedExitUpdate,
      highestTargetLevel,
      stopLossReached,
    };
  }

  if (isRealtimeSimultaneousExit) {
    return {
      accepted: false,
      rejectionCode: 'ignored_simultaneous_exit_with_entry',
      rejectionMessage: 'EXIT timestamp overlaps ENTRY timestamp; waiting for confirmed TP/SL progression.',
      normalizedExitUpdate,
      highestTargetLevel,
      stopLossReached,
    };
  }

  if (isStopReason && (rawStopLossReached || (typeof rawExitPrice !== 'number' && stopLossReached))) {
    return {
      accepted: true,
      normalizedExitUpdate,
      status: 'Stoploss Hit',
      resolvedExitReason: String(exitReason || 'STOP_LOSS').trim() || 'STOP_LOSS',
      highestTargetLevel,
      stopLossReached,
    };
  }

  if (highestTargetLevel) {
    const status = reachedFinalTarget ? 'Target Hit' : 'Partial Profit Book';
    return {
      accepted: true,
      normalizedExitUpdate,
      status,
      resolvedExitReason: reachedFinalTarget ? String(exitReason || 'TARGET_HIT').trim() || 'TARGET_HIT' : 'Partial Profit Book',
      highestTargetLevel,
      stopLossReached,
    };
  }

  return {
    accepted: false,
    rejectionCode: 'ignored_exit_without_tp_sl_confirmation',
    rejectionMessage: 'EXIT price does not confirm TP or Stop Loss execution.',
    normalizedExitUpdate,
    highestTargetLevel,
    stopLossReached,
  };
};

const getSignalReferenceTime = (signal) => {
  return (
    parseSignalTimestamp(signal?.signalTime) ||
    parseSignalTimestamp(signal?.createdAt) ||
    parseSignalTimestamp(signal?.updatedAt) ||
    null
  );
};

const getStopLossConsistencyTolerance = (signal) => {
  const entryPrice = toFiniteNumber(signal?.entryPrice);
  const stopLoss = toFiniteNumber(signal?.stopLoss);
  const stopGap =
    typeof entryPrice === 'number' && typeof stopLoss === 'number' ? Math.abs(stopLoss - entryPrice) : 0;
  const proportionalTolerance = stopGap > 0 ? stopGap * 0.1 : 0;
  const priceTolerance = typeof stopLoss === 'number' ? Math.abs(stopLoss) * 0.0001 : 0;
  return Math.max(roundSignalValue(proportionalTolerance), roundSignalValue(priceTolerance), 0.05);
};

const isStopLossExitPriceConsistent = ({ signal, exitPrice }) => {
  const resolvedExitPrice = toFiniteNumber(exitPrice);
  const stopLoss = toFiniteNumber(signal?.stopLoss);
  if (typeof resolvedExitPrice !== 'number' || typeof stopLoss !== 'number') {
    return true;
  }

  const tolerance = getStopLossConsistencyTolerance(signal);
  const signalType = String(signal?.type || 'BUY').trim().toUpperCase();

  if (signalType === 'SELL') {
    return resolvedExitPrice >= stopLoss - tolerance;
  }

  if (signalType === 'BUY') {
    return resolvedExitPrice <= stopLoss + tolerance;
  }

  return true;
};

const getSuspiciousExitLagThresholdMs = (timeframe) => {
  const timeframeMs = getTimeframeDurationMs(timeframe);
  if (!timeframeMs) {
    return 90 * 60 * 1000;
  }

  return Math.min(Math.max(timeframeMs * 4, 90 * 60 * 1000), 6 * 60 * 60 * 1000);
};

const normalizeExitWebhookPayload = ({
  signal,
  exitReason,
  exitPrice,
  totalPoints,
  exitTime,
  receivedAt = new Date(),
  timeframeFromPayload = '',
} = {}) => {
  const normalizedReason = String(exitReason || '').trim().toUpperCase();
  const receivedDate = parseSignalTimestamp(receivedAt) || new Date();
  const signalTimeframe =
    normalizeSignalTimeframe(timeframeFromPayload) ||
    normalizeSignalTimeframe(signal?.timeframe) ||
    String(timeframeFromPayload || signal?.timeframe || '').trim();
  const signalReferenceTime = getSignalReferenceTime(signal);
  const timeframeProvided = Boolean(String(timeframeFromPayload || '').trim());
  const normalized = {
    exitPrice: toFiniteNumber(exitPrice),
    totalPoints: deriveExitPoints({ signal, exitPrice, totalPoints }),
    exitTime: parseSignalTimestamp(exitTime) || null,
    sanitized: false,
    sanitizedFields: [],
  };

  const addSanitizedField = (field) => {
    normalized.sanitized = true;
    if (!normalized.sanitizedFields.includes(field)) {
      normalized.sanitizedFields.push(field);
    }
  };

  if ((normalizedReason.includes('STOP') || normalizedReason.includes('SL')) && !isStopLossExitPriceConsistent({
    signal,
    exitPrice: normalized.exitPrice,
  })) {
    const stopLoss = toFiniteNumber(signal?.stopLoss);
    if (typeof stopLoss === 'number') {
      normalized.exitPrice = roundSignalValue(stopLoss);
      normalized.totalPoints = deriveExitPoints({
        signal,
        exitPrice: normalized.exitPrice,
        totalPoints: undefined,
      });
      addSanitizedField('exitPrice');
      addSanitizedField('totalPoints');
    }

    normalized.exitTime = receivedDate;
    addSanitizedField('exitTime');
  }

  if (!normalized.exitTime) {
    normalized.exitTime = receivedDate;
    addSanitizedField('exitTime');
  }

  if (
    signalReferenceTime &&
    normalized.exitTime &&
    normalized.exitTime.getTime() < signalReferenceTime.getTime()
  ) {
    normalized.exitTime = receivedDate;
    addSanitizedField('exitTime');
  }

  if (
    !timeframeProvided &&
    normalized.exitTime &&
    receivedDate.getTime() - normalized.exitTime.getTime() > getSuspiciousExitLagThresholdMs(signalTimeframe)
  ) {
    normalized.exitTime = receivedDate;
    addSanitizedField('exitTime');
  }

  return normalized;
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

const parseWebhookDate = (value, options = {}) => {
  return parseSignalTimestamp(value, options);
};

const isDelayedFeedSignal = ({ symbol = '', segment = '' } = {}) => {
  const normalizedSegment = String(segment || '').trim().toUpperCase();
  if (['COMEX', 'NYMEX', 'CRYPTO', 'CURRENCY', 'FOREX'].includes(normalizedSegment)) return true;

  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (
    /(?:^|:)(XAUUSD|XAGUSD|WTI|USOIL|UKOIL|BRENTUSD|CL1!|BRN1!|NG1!|GC1!|GCI|XPTUSD|COPPERUSD|NATGASUSD)$/.test(
      normalizedSymbol
    )
  ) {
    return true;
  }

  if (
    /^(EURUSD|GBPUSD|USDJPY|AUDUSD|NZDUSD|USDCAD|USDCHF|EURJPY|GBPJPY|EURGBP|AUDJPY|AUDNZD|NZDJPY|EURAUD|EURAUD|GBPAUD|EURCAD|EURCHF|CADJPY|CHFJPY|EURINR|USDINR|GBPINR|JPYINR)$/i.test(
      normalizedSymbol
    )
  ) {
    return true;
  }

  return false;
};

const getAllowedSignalAgeMs = (timeframe, context = {}) => {
  const timeframeMs = getTimeframeDurationMs(timeframe);
  const baseAgeMs = timeframeMs
    ? Math.min(Math.max(timeframeMs * 4, MIN_STALE_ENTRY_SIGNAL_AGE_MS), MAX_STALE_ENTRY_SIGNAL_AGE_MS)
    : MIN_STALE_ENTRY_SIGNAL_AGE_MS;

  if (!isDelayedFeedSignal(context)) {
    return baseAgeMs;
  }

  // Some webhook providers deliver COMEX, crypto, and forex entries with multi-hour delay.
  return Math.max(baseAgeMs, DELAYED_FEED_MIN_STALE_ENTRY_SIGNAL_AGE_MS);
};

const buildProcessedEntrySignalKey = (uniqueId = '') => {
  const normalized = String(uniqueId || '').trim();
  if (!normalized) return '';
  return `processed_signal_entry:${normalized}`;
};

const formatWebhookAuditValue = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'NA' : value.toISOString();
  }

  const normalized = String(value ?? '').trim();
  return normalized || 'NA';
};

const getWebhookTimingLagMs = (parsedTime, receivedAt) => {
  if (!(parsedTime instanceof Date) || Number.isNaN(parsedTime.getTime())) {
    return 'NA';
  }

  const receivedTime =
    receivedAt instanceof Date && !Number.isNaN(receivedAt.getTime()) ? receivedAt : new Date();
  return String(receivedTime.getTime() - parsedTime.getTime());
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
  const receivedAt = new Date(startedAt);
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
  const rawTimeframe = getWebhookTimeframeValue(req.body);
  const normalizedTimeframe = normalizeSignalTimeframe(rawTimeframe);
  const webhookTimestampContext = {
    symbol,
    segment,
    referenceTime: startedAt,
  };
  const isEntryEvent = !['INFO', 'EXIT'].includes(event);
  const parsedSignalTime = parseWebhookDate(req.body.signal_time, webhookTimestampContext);
  const signalAgeMs =
    isEntryEvent && parsedSignalTime ? Date.now() - parsedSignalTime.getTime() : null;
  const allowedSignalAgeMs =
    isEntryEvent && parsedSignalTime ? getAllowedSignalAgeMs(normalizedTimeframe, webhookTimestampContext) : null;
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

  logger.info(
    `[WEBHOOK] received event=${event || 'ENTRY'} webhookId=${webhookId || 'NA'} symbolInput=${symbolInput || 'NA'} ` +
    `resolvedSymbol=${symbol || 'NA'} segment=${segment || 'NA'} timeframe=${normalizedTimeframe || 'NA'}`
  );
  if (event === 'INFO') {
    const parsedInfoTime = parseWebhookDate(req.body.time, webhookTimestampContext);
    logger.info(
      `[WEBHOOK_TIMING] event=INFO webhookId=${webhookId || 'NA'} symbol=${symbol || 'NA'} ` +
        `timeframe=${normalizedTimeframe || 'NA'} rawTime=${formatWebhookAuditValue(req.body.time)} ` +
        `parsedTime=${formatWebhookAuditValue(parsedInfoTime)} receivedAt=${receivedAt.toISOString()} ` +
        `lagMs=${getWebhookTimingLagMs(parsedInfoTime, receivedAt)}`
    );
  } else if (event === 'EXIT') {
    const parsedExitTimeForAudit = parseWebhookDate(req.body.exit_time, webhookTimestampContext);
    logger.info(
      `[WEBHOOK_TIMING] event=EXIT webhookId=${webhookId || 'NA'} symbol=${symbol || 'NA'} ` +
        `timeframe=${normalizedTimeframe || 'NA'} rawExitTime=${formatWebhookAuditValue(req.body.exit_time)} ` +
        `parsedExitTime=${formatWebhookAuditValue(parsedExitTimeForAudit)} receivedAt=${receivedAt.toISOString()} ` +
        `lagMs=${getWebhookTimingLagMs(parsedExitTimeForAudit, receivedAt)}`
    );
  } else {
    logger.info(
      `[WEBHOOK_TIMING] event=ENTRY webhookId=${webhookId || 'NA'} symbol=${symbol || 'NA'} ` +
        `timeframe=${normalizedTimeframe || 'NA'} rawSignalTime=${formatWebhookAuditValue(req.body.signal_time)} ` +
        `parsedSignalTime=${formatWebhookAuditValue(parsedSignalTime)} receivedAt=${receivedAt.toISOString()} ` +
        `lagMs=${getWebhookTimingLagMs(parsedSignalTime, receivedAt)}`
    );
  }

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

  const findSignalByWebhookId = async (
    webhookId,
    { eventTime = null, expectedType = null, allowScopedFallback = true } = {}
  ) => {
    const id = String(webhookId || '').trim();
    const baseFilter = symbol ? { symbol, segment } : { segment };
    const timeframeFilter = buildTimeframeQuery('timeframe', normalizedTimeframe);
    const buildScopedFilters = (filter, includeTimeframe = true) =>
      includeTimeframe && timeframeFilter ? [{ ...filter, ...timeframeFilter }] : [filter];
    const resolveCandidateResult = (signals = []) => {
      const result = selectWebhookSignalCandidate({
        signals,
        eventTime,
        timeframe: normalizedTimeframe,
        expectedType,
      });

      if (result.ambiguous && !timeframeFilter) {
        logger.warn(
          `[WEBHOOK] Ambiguous signal match for ${symbol || 'unknown'} webhookId=${id}. Multiple timeframes active; include timeframe in webhook EXIT/INFO payload.`
        );
      }

      return result;
    };
    const collectCandidates = async ({
      includeClosed = false,
      requireWebhookId = true,
      ignoreTimeframe = false,
    } = {}) => {
      const scopedFilters = buildScopedFilters(baseFilter, !ignoreTimeframe);
      const statusFilter = includeClosed ? {} : { status: { $nin: getSignalClosedStatuses() } };
      const queries = scopedFilters.map((scopedFilter) =>
        Signal.find({
          ...TRADINGVIEW_SIGNAL_SOURCE_FILTER,
          ...scopedFilter,
          ...statusFilter,
          ...(expectedType ? { type: expectedType } : {}),
          ...(requireWebhookId && id ? { $or: [{ uniqueId: id }, { webhookId: id }] } : {}),
        })
          .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
          .limit(requireWebhookId && id ? 5 : 20)
      );

      if (symbol) {
        buildScopedFilters({ symbol }, !ignoreTimeframe).forEach((scopedFilter) => {
          queries.push(
            Signal.find({
              ...TRADINGVIEW_SIGNAL_SOURCE_FILTER,
              ...scopedFilter,
              ...statusFilter,
              ...(expectedType ? { type: expectedType } : {}),
              ...(requireWebhookId && id ? { $or: [{ uniqueId: id }, { webhookId: id }] } : {}),
            })
              .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
              .limit(requireWebhookId && id ? 5 : 20)
          );
        });
      }

      const queryResults = await Promise.all(queries);
      return queryResults.flat();
    };

    if (!id) {
      return resolveCandidateResult(
        await collectCandidates({
          requireWebhookId: false,
        })
      );
    }

    // 1) If webhook sends our MongoDB _id
    if (mongoose.Types.ObjectId.isValid(id)) {
      const byId = await Signal.findOne({
        _id: id,
        ...TRADINGVIEW_SIGNAL_SOURCE_FILTER,
      });
      if (byId) return { signal: byId, ambiguous: false };
    }

    // 2) Match by the caller-provided ID first.
    if (id) {
      const activeMatchResult = resolveCandidateResult(await collectCandidates());
      if (activeMatchResult.signal || activeMatchResult.ambiguous) {
        return activeMatchResult;
      }

      // Some feeds emit EXIT timeframe labels that differ from the ENTRY timeframe
      // (for example, 1s/5m EXIT over 15m ENTRY). Retry by webhook identity without
      // timeframe scoping so settled exits still land on the active signal.
      if (timeframeFilter) {
        const identityRetryResult = resolveCandidateResult(
          await collectCandidates({
            ignoreTimeframe: true,
          })
        );
        if (identityRetryResult.signal || identityRetryResult.ambiguous) {
          return identityRetryResult;
        }
      }
    }

    // 3) Fallback to scoped symbol/segment/timeframe matching when upstream webhook IDs
    // are reused or missing. This is common in the current production feed.
    if (allowScopedFallback) {
      const activeFallbackResult = resolveCandidateResult(
        await collectCandidates({
          requireWebhookId: false,
        })
      );
      if (activeFallbackResult.signal || activeFallbackResult.ambiguous || !req.body.exit_time) {
        return activeFallbackResult;
      }
    } else if (!req.body.exit_time) {
      return { signal: null, ambiguous: false };
    }

    // 4) If already closed (idempotent EXIT), match on exit_time too.
    if (req.body.exit_time) {
      const exitTime =
        eventTime instanceof Date && !Number.isNaN(eventTime.getTime())
          ? eventTime
          : parseWebhookDate(req.body.exit_time, webhookTimestampContext);
      if (!exitTime) {
        return { signal: null, ambiguous: false };
      }
      const filterClosedCandidatesByExitTime = (candidates = []) =>
        candidates.filter((candidate) => {
          const candidateExitTime = candidate?.exitTime ? new Date(candidate.exitTime).getTime() : NaN;
          return Number.isFinite(candidateExitTime) && candidateExitTime === exitTime.getTime();
        });

      if (id) {
        const closedCandidates = filterClosedCandidatesByExitTime(await collectCandidates({ includeClosed: true }));
        const closedMatchResult = resolveCandidateResult(closedCandidates);
        if (closedMatchResult.signal || closedMatchResult.ambiguous) {
          return closedMatchResult;
        }
      }

      const closedFallbackCandidates = filterClosedCandidatesByExitTime(
        await collectCandidates({
          includeClosed: true,
          requireWebhookId: false,
        })
      );
      return resolveCandidateResult(closedFallbackCandidates);
    }

    return { signal: null, ambiguous: false };
  };

  if (event === 'INFO') {
    const parsedInfoTime = parseWebhookDate(req.body.time, webhookTimestampContext);
    const { signal: existing, ambiguous } = await findSignalByWebhookId(webhookId, {
      eventTime: parsedInfoTime || req.body.time,
    });
    if (ambiguous) {
      logger.warn(
        `[WEBHOOK] INFO ambiguous match symbol=${symbol} webhookId=${webhookId || 'NA'} timeframe=${normalizedTimeframe || 'NA'}`
      );
      return sendWebhookResponse(httpStatus.OK, {
        status: 'ambiguous_timeframe',
        uniq_id: webhookId,
        symbol,
        timeframe: normalizedTimeframe || null,
      });
    }
    if (!existing) {
      logger.warn(
        `[WEBHOOK] INFO target signal not found symbol=${symbol} webhookId=${webhookId || 'NA'} timeframe=${normalizedTimeframe || 'NA'}`
      );
      return sendWebhookResponse(httpStatus.OK, {
        status: 'not_found',
        uniq_id: webhookId,
        symbol,
        timeframe: normalizedTimeframe || null,
      });
    }

    const currentPrice = toFiniteNumber(req.body.price);
    const infoTime = parsedInfoTime || req.body.time;
    const targetLevel = resolveInfoTargetLevel(req.body.message);
    const isValidTargetProgress = isValidInfoTargetProgress({
      signal: existing,
      targetLevel,
      price: currentPrice,
    });

    if (!isValidTargetProgress) {
      logger.warn(
        `[WEBHOOK] Ignoring invalid ${targetLevel || 'INFO'} progress for ${existing.symbol} ` +
          `timeframe=${existing.timeframe || 'unknown'} webhookId=${webhookId} price=${currentPrice}`
      );
      return sendWebhookResponse(httpStatus.OK, {
        status: 'ignored_invalid_target_progress',
        signal: existing,
        info: { targetLevel, message: req.body.message },
      });
    }

    const noteText = buildInfoUpdateMessage({
      message: req.body.message,
      targetLevel,
      price: currentPrice,
      time: infoTime,
    });

    const autoClosedSignal =
      typeof currentPrice === 'number'
        ? await signalService.reconcileSignalWithMarketPrice(existing, currentPrice, {
            occurredAt: infoTime,
            notes: noteText,
            exitReason: targetLevel ? `AUTO_INFO_${targetLevel}_REACHED` : 'AUTO_INFO_MARKET_SETTLED',
            updateMessage: noteText,
          })
        : null;

    if (autoClosedSignal) {
      logger.info(
        `[WEBHOOK] INFO auto-closed signal=${autoClosedSignal.id} symbol=${autoClosedSignal.symbol} status=${autoClosedSignal.status}`
      );
      return sendWebhookResponse(httpStatus.OK, {
        status: 'ok',
        signal: autoClosedSignal,
        info: { targetLevel, message: req.body.message, autoClosed: true },
      });
    }

    if (existing.notes === noteText) {
      return sendWebhookResponse(httpStatus.OK, {
        status: 'ok',
        signal: existing,
        info: { targetLevel, message: req.body.message },
      });
    }

    const updated = await signalService.updateSignalById(existing.id, {
      notes: noteText,
      lastInfoPrice: currentPrice,
      lastInfoTime: infoTime,
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
    logger.info(
      `[WEBHOOK] INFO updated signal=${updated.id} symbol=${updated.symbol} status=${updated.status} targetLevel=${targetLevel || 'INFO'}`
    );

    return sendWebhookResponse(httpStatus.OK, {
      status: 'ok',
      signal: updated,
      info: { targetLevel, message: req.body.message },
    });
  }

  if (event === 'EXIT') {
    if (!webhookId) {
      logger.warn(`[WEBHOOK] EXIT ignored due to missing uniq_id symbol=${symbol} timeframe=${normalizedTimeframe || 'NA'}`);
      return sendWebhookResponse(httpStatus.OK, {
        status: 'ignored_missing_uniq_id',
        symbol,
        timeframe: normalizedTimeframe || null,
      });
    }

    const parsedExitTime = parseWebhookDate(req.body.exit_time, webhookTimestampContext);
    const expectedType = resolveExitedSignalType(req.body.trade_type || req.body.tradeType);
    const { signal: existing, ambiguous } = await findSignalByWebhookId(webhookId, {
      eventTime: parsedExitTime || req.body.exit_time,
      expectedType,
      allowScopedFallback: false,
    });
    if (ambiguous) {
      logger.warn(
        `[WEBHOOK] EXIT ambiguous match symbol=${symbol} webhookId=${webhookId || 'NA'} timeframe=${normalizedTimeframe || 'NA'}`
      );
      return sendWebhookResponse(httpStatus.OK, {
        status: 'ambiguous_timeframe',
        uniq_id: webhookId,
        symbol,
        timeframe: normalizedTimeframe || null,
      });
    }
    if (!existing) {
      logger.warn(
        `[WEBHOOK] EXIT target signal not found symbol=${symbol} webhookId=${webhookId || 'NA'} timeframe=${normalizedTimeframe || 'NA'}`
      );
      return sendWebhookResponse(httpStatus.OK, {
        status: 'not_found',
        uniq_id: webhookId,
        symbol,
        timeframe: normalizedTimeframe || null,
      });
    }

    const exitAssessment = assessExitSettlementCandidate({
      signal: existing,
      exitReason: req.body.exit_reason,
      exitPrice: req.body.exit_price,
      totalPoints: req.body.total_points,
      parsedExitTime,
      receivedAt: new Date(startedAt),
      timeframeFromPayload: rawTimeframe,
    });
    const normalizedExitUpdate = exitAssessment.normalizedExitUpdate;

    if (!exitAssessment.accepted) {
      logger.warn(
        `[WEBHOOK] EXIT ignored signal=${existing.id} symbol=${existing.symbol} reason=${exitAssessment.rejectionCode} ` +
          `webhookId=${webhookId || 'NA'} exitPrice=${normalizedExitUpdate.exitPrice ?? 'NA'} ` +
          `exitTime=${normalizedExitUpdate.exitTime?.toISOString?.() || 'NA'}`
      );
      return sendWebhookResponse(httpStatus.OK, {
        status: exitAssessment.rejectionCode,
        message: exitAssessment.rejectionMessage,
        signal: existing,
      });
    }

    const incomingExitTime = normalizedExitUpdate.exitTime;
    const incomingExitPrice = normalizedExitUpdate.exitPrice;
    const resolvedTotalPoints = normalizedExitUpdate.totalPoints;
    const desiredStatus = exitAssessment.status;
    const isNumberClose = (a, b, eps = 1e-6) => {
      if (typeof a !== 'number' || typeof b !== 'number') return false;
      return Math.abs(a - b) <= eps;
    };

    const resolvedExitReason = exitAssessment.resolvedExitReason;

    const alreadyApplied =
      existing.exitTime &&
      existing.status === desiredStatus &&
      existing.exitReason === resolvedExitReason &&
      isNumberClose(existing.exitPrice, incomingExitPrice) &&
      isNumberClose(existing.totalPoints, resolvedTotalPoints) &&
      Boolean(incomingExitTime) &&
      new Date(existing.exitTime).getTime() === incomingExitTime.getTime();

    if (alreadyApplied) {
      return sendWebhookResponse(httpStatus.OK, { status: 'ok', signal: existing });
    }

    const existingAlreadyClosed = getSignalClosedStatuses().includes(String(existing.status || '').trim());
    if (
      existingAlreadyClosed &&
      existing.exitTime &&
      (!incomingExitTime || new Date(existing.exitTime).getTime() >= incomingExitTime.getTime())
    ) {
      logger.info(
        `[WEBHOOK] EXIT ignored for already settled signal=${existing.id} symbol=${existing.symbol} ` +
        `existingExit=${new Date(existing.exitTime).toISOString()} incomingExit=${incomingExitTime ? incomingExitTime.toISOString() : 'NA'}`
      );
      return sendWebhookResponse(httpStatus.OK, { status: 'already_closed', signal: existing });
    }

    if (normalizedExitUpdate.sanitized) {
      logger.warn(
        `[WEBHOOK] Normalized suspicious EXIT payload for ${existing.symbol} ` +
          `timeframe=${existing.timeframe || 'unknown'} webhookId=${webhookId || 'NA'} ` +
          `fields=${normalizedExitUpdate.sanitizedFields.join(',') || 'none'} ` +
          `rawExitPrice=${req.body.exit_price} normalizedExitPrice=${incomingExitPrice} ` +
          `rawExitTime=${req.body.exit_time || 'NA'} normalizedExitTime=${incomingExitTime?.toISOString?.() || 'NA'}`
      );
    }

    const updateBody = {
      exitPrice: incomingExitPrice,
      totalPoints: resolvedTotalPoints,
      exitReason: resolvedExitReason,
      exitTime: incomingExitTime,
      status: desiredStatus,
    };

    const updated = await signalService.updateSignalById(existing.id, updateBody);
    logger.info(
      `[WEBHOOK] EXIT settled signal=${updated.id} symbol=${updated.symbol} status=${updated.status} ` +
      `exitPrice=${updated.exitPrice ?? 'NA'} points=${updated.totalPoints ?? 'NA'} reason=${updated.exitReason || 'NA'}`
    );
    return sendWebhookResponse(httpStatus.OK, { status: 'ok', signal: updated });
  }

  const normalizedType = String(req.body.trade_type || '').trim().toUpperCase();

  const signalBody = {
    source: 'TRADINGVIEW',
    uniqueId: buildWebhookSignalId({
      webhookId,
      symbol,
      segment,
      tradeType: normalizedType,
      timeframe: normalizedTimeframe,
      entryPrice: req.body.entry_price,
      signalTime: parsedSignalTime || req.body.signal_time,
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
    signalTime: parsedSignalTime || req.body.signal_time,
    isFree,
    status: 'Active',
  };
  const processedEntryAlreadySeen = await hasProcessedEntrySignal(signalBody.uniqueId);

  // Upsert behavior for ENTRY webhooks: if the same `uniqueId` arrives again with updated fields,
  // update the existing signal instead of returning stale data.
  const existingByUniqueId = await Signal.findOne({
    uniqueId: signalBody.uniqueId,
    ...TRADINGVIEW_SIGNAL_SOURCE_FILTER,
  }).sort({ createdAt: -1 });
  if (existingByUniqueId) {
    const updateBody = {
      source: 'TRADINGVIEW',
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
      `[WEBHOOK] Ignoring stale ENTRY signal for ${symbol}. signalTime=${parsedSignalTime.toISOString()} ageMs=${signalAgeMs} allowedAgeMs=${allowedSignalAgeMs} timeframe=${normalizedTimeframe || 'NA'} webhookId=${webhookId || 'NA'} uniqueId=${signalBody.uniqueId}`
    );
    return sendWebhookResponse(httpStatus.OK, {
      status: 'stale_ignored',
      symbol,
      timeframe: normalizedTimeframe || null,
      signalTime: parsedSignalTime.toISOString(),
      ageMs: signalAgeMs,
      allowedAgeMs: allowedSignalAgeMs,
      uniqueId: signalBody.uniqueId,
    });
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

  if (webhookId) {
    const webhookIdentityFilter = {
      ...TRADINGVIEW_SIGNAL_SOURCE_FILTER,
      webhookId,
      symbol: signalBody.symbol,
      type: signalBody.type,
    };
    if (signalBody.segment) webhookIdentityFilter.segment = signalBody.segment;
    if (signalBody.timeframe) {
      const timeframeFilter = buildTimeframeQuery('timeframe', signalBody.timeframe);
      if (timeframeFilter) Object.assign(webhookIdentityFilter, timeframeFilter);
    }

    const existingByWebhookIdentity = await Signal.findOne(webhookIdentityFilter).sort({ createdAt: -1 });
    if (existingByWebhookIdentity) {
      const updateBody = {
        source: 'TRADINGVIEW',
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
      const updated = await signalService.updateSignalById(existingByWebhookIdentity.id, updateBody);
      await rememberProcessedEntrySignal(signalBody.uniqueId);
      return sendWebhookResponse(httpStatus.OK, { status: 'ok', signal: updated, updatedExisting: true });
    }
  }

  logger.info(
    `[WEBHOOK] ENTRY created signal=${created.id} symbol=${created.symbol} timeframe=${created.timeframe || 'NA'} ` +
    `signalTime=${created.signalTime ? new Date(created.signalTime).toISOString() : 'NA'}`
  );

  await signalService.settleOppositeActiveSignalsForEntry({
    symbol: created.symbol,
    segment: created.segment,
    timeframe: created.timeframe,
    type: created.type,
    entryPrice: created.entryPrice,
    signalTime: created.signalTime || created.createdAt,
    excludeSignalId: created.id,
    skipSideEffects: true,
  });

  await rememberProcessedEntrySignal(signalBody.uniqueId);
  return sendWebhookResponse(httpStatus.OK, { status: 'ok', signal: created });
});

export default {
  receiveSignal,
};

export {
  assessExitSettlementCandidate,
  deriveExitStatus,
  getAllowedSignalAgeMs,
  isStopLossExitPriceConsistent,
  isValidInfoTargetProgress,
  normalizeExitWebhookPayload,
};

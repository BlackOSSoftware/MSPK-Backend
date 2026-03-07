import httpStatus from 'http-status';
import mongoose from 'mongoose';
import Signal from '../models/Signal.js';
import MasterSymbol from '../models/MasterSymbol.js';
import catchAsync from '../utils/catchAsync.js';
import { signalService } from '../services/index.js';
import {
  buildWebhookSignalId,
  normalizeSignalSegment,
  normalizeSignalSymbol,
} from '../utils/signalRouting.js';

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeTimeframe = (timeframe) => {
  if (timeframe === null || timeframe === undefined) return timeframe;
  const tf = String(timeframe).trim();
  if (!tf) return tf;
  // If sender sends "1" / "5" etc, interpret as minutes.
  if (/^\d+$/.test(tf)) return `${tf}m`;
  return tf;
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

const getSignalClosedStatuses = () => ['Closed', 'Target Hit', 'Partial Profit Book', 'Stoploss Hit'];

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

const resolveMasterSymbol = async (input) => {
  const rawInput = String(input || '').trim();
  if (!rawInput) return null;

  const normalizedSymbol = normalizeSignalSymbol(rawInput);
  const filters = [
    { symbolId: new RegExp(`^${escapeRegex(rawInput)}$`, 'i') },
    { symbol: normalizedSymbol },
  ];

  if (mongoose.Types.ObjectId.isValid(rawInput)) {
    filters.unshift({ _id: rawInput });
  }

  return MasterSymbol.findOne({ $or: filters }).lean();
};

const receiveSignal = catchAsync(async (req, res) => {
  const event = String(req.body.event || '').trim().toUpperCase();
  const webhookId = String(
    req.body.uniq_id || req.body.unique_id || req.body.uniqueId || req.body.uniqe_id || ''
  ).trim();
  const symbolInput = getWebhookSymbolInput(req.body);
  const resolvedMasterSymbol = await resolveMasterSymbol(symbolInput);
  const symbolIdRequested =
    Boolean(req.body.symbol_id || req.body.symbolId || req.body.master_symbol_id || req.body.masterSymbolId) ||
    looksLikeMasterSymbolId(symbolInput);
  const symbol = resolvedMasterSymbol
    ? normalizeSignalSymbol(resolvedMasterSymbol.symbol)
    : normalizeSignalSymbol(req.body.symbol || symbolInput);
  const segment = resolvedMasterSymbol
    ? normalizeSignalSegment(resolvedMasterSymbol.segment, resolvedMasterSymbol.symbol)
    : normalizeSignalSegment(req.body.segment, symbol);
  const isFreeFromPayload = parseBoolean(req.body.is_free ?? req.body.isFree ?? req.body.free);
  const isFree = isFreeFromPayload ?? false;

  if (symbolIdRequested && symbolInput && !resolvedMasterSymbol) {
    return res
      .status(httpStatus.BAD_REQUEST)
      .send({ message: 'Provided symbol ID does not match any master symbol.', symbolId: symbolInput });
  }

  if (!symbol || !segment) {
    return res.status(httpStatus.BAD_REQUEST).send({
      message: 'Valid symbol and segment are required to process webhook.',
      symbol: symbolInput || req.body.symbol || '',
    });
  }

  const findSignalByWebhookId = async (webhookId) => {
    if (!webhookId) return null;
    const id = String(webhookId).trim();
    const baseFilter = symbol ? { symbol, segment } : { segment };

    // 1) If webhook sends our MongoDB _id
    if (mongoose.Types.ObjectId.isValid(id)) {
      const byId = await Signal.findById(id);
      if (byId) return byId;
    }

    // 2) Match by the caller-provided ID first.
    const byExternalId = await Signal.findOne({
      ...baseFilter,
      $or: [{ uniqueId: id }, { webhookId: id }],
      status: { $nin: getSignalClosedStatuses() },
    }).sort({ createdAt: -1 });
    if (byExternalId) return byExternalId;

    if (symbol) {
        const byLegacySymbolOnly = await Signal.findOne({
          symbol,
          $or: [{ uniqueId: id }, { webhookId: id }],
          status: { $nin: getSignalClosedStatuses() },
        }).sort({ createdAt: -1 });
      if (byLegacySymbolOnly) return byLegacySymbolOnly;
    }

    // 3) If already closed (idempotent EXIT), match on exit_time too.
    if (req.body.exit_time) {
      const exitTime = new Date(req.body.exit_time);
      const byClosed = await Signal.findOne({
        ...baseFilter,
        $or: [{ uniqueId: id }, { webhookId: id }],
        exitTime,
      }).sort({ createdAt: -1 });
      if (byClosed) return byClosed;

      if (symbol) {
        const byLegacyClosed = await Signal.findOne({
          symbol,
          $or: [{ uniqueId: id }, { webhookId: id }],
          exitTime,
        }).sort({ createdAt: -1 });
        if (byLegacyClosed) return byLegacyClosed;
      }
    }

    return null;
  };

  if (event === 'EXIT') {
    const existing = await findSignalByWebhookId(webhookId);
    if (!existing) {
      return res.status(httpStatus.OK).send({ status: 'not_found', uniq_id: webhookId, symbol });
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
      return res.status(httpStatus.OK).send({ status: 'ok', signal: existing });
    }

    const updateBody = {
      exitPrice: incomingExitPrice,
      totalPoints: resolvedTotalPoints,
      exitReason: resolvedExitReason,
      exitTime: req.body.exit_time,
      status: desiredStatus,
    };

    const updated = await signalService.updateSignalById(existing.id, updateBody);
    return res.status(httpStatus.OK).send({ status: 'ok', signal: updated });
  }

  const normalizedTimeframe = normalizeTimeframe(req.body.timeframe);
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
      return res.status(httpStatus.OK).send({ status: 'ok', signal: updated, updatedExisting: true });
    }
  }

  const created = await signalService.createSignal(signalBody, null);

  // signalService has an in-memory 5m dedup guard that can return null.
  if (!created) {
    const afterGuard = await Signal.findOne({ uniqueId: signalBody.uniqueId });
    return res.status(httpStatus.OK).send({ status: 'duplicate_blocked', signal: afterGuard || null });
  }

  return res.status(httpStatus.OK).send({ status: 'ok', signal: created });
});

export default {
  receiveSignal,
};

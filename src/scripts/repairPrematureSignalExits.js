import mongoose from 'mongoose';

import connectDB from '../config/database.js';
import Signal from '../models/Signal.js';
import signalService from '../services/signal.service.js';

const CLOSED_SIGNAL_STATUSES = ['Closed', 'Target Hit', 'Partial Profit Book', 'Stoploss Hit'];

const hasFlag = (name) => process.argv.includes(`--${name}`);
const readNumericArg = (name, fallback) => {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!match) return fallback;
  const parsed = Number.parseInt(match.split('=').slice(1).join('='), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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

const dryRun = !hasFlag('apply');
const limit = Math.max(0, readNumericArg('limit', 0));

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

const getSignalStart = (signal) => {
  const value = signal?.signalTime || signal?.createdAt || null;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getSignalExit = (signal) => {
  const value = signal?.exitTime || null;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const run = async () => {
  await connectDB();

  let query = Signal.find({
    ...buildTradingViewSignalFilter(),
    status: { $in: CLOSED_SIGNAL_STATUSES },
  }).sort({ updatedAt: -1, createdAt: -1, _id: -1 });

  if (limit > 0) {
    query = query.limit(limit);
  }

  const candidates = await query.lean();
  const repairs = [];

  for (const signal of candidates) {
    const entryTime = getSignalStart(signal);
    const exitTime = getSignalExit(signal);
    const exitPrice = toFiniteNumber(signal.exitPrice);
    const status = String(signal.status || '').trim();
    const highestTargetLevel = signalService.getSignalHighestAchievedTargetLevel(signal, exitPrice);
    const stopLossReached = signalService.hasSignalReachedStopLoss(signal, exitPrice);
    const reason = String(signal.exitReason || '').trim().toUpperCase();

    const hasValidTpEvidence = Boolean(highestTargetLevel);
    const hasValidSlEvidence = Boolean(stopLossReached && /(STOP|SL)/.test(reason || status));
    const hasAnyExecutionEvidence = hasValidTpEvidence || hasValidSlEvidence;
    const isOutOfSequence =
      entryTime instanceof Date &&
      exitTime instanceof Date &&
      exitTime.getTime() < entryTime.getTime();

    const statusImpliesTarget = status === 'Target Hit' || status === 'Partial Profit Book';
    const statusImpliesStop = status === 'Stoploss Hit';
    const statusEvidenceMismatch =
      (statusImpliesTarget && !hasValidTpEvidence) || (statusImpliesStop && !hasValidSlEvidence);

    const shouldRepair =
      isOutOfSequence ||
      typeof exitPrice !== 'number' ||
      !hasAnyExecutionEvidence ||
      statusEvidenceMismatch;

    if (!shouldRepair) continue;

    repairs.push({
      signalId: String(signal._id),
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      type: signal.type,
      fromStatus: status,
      toStatus: 'Active',
      entryTime: entryTime?.toISOString?.() || null,
      exitTime: exitTime?.toISOString?.() || null,
      exitPrice: signal.exitPrice ?? null,
      exitReason: signal.exitReason || null,
      highestTargetLevel: highestTargetLevel || null,
      stopLossReached,
      repairReason: isOutOfSequence
        ? 'out_of_sequence_exit'
        : typeof exitPrice !== 'number'
          ? 'missing_exit_price'
          : statusEvidenceMismatch
            ? 'status_mismatch_with_execution_evidence'
            : 'missing_tp_sl_execution_evidence',
    });
  }

  if (!dryRun) {
    for (const repair of repairs) {
      await Signal.updateOne(
        { _id: repair.signalId },
        {
          $set: {
            status: 'Active',
            notes: '[Auto Repair] Reopened: previous EXIT had no valid TP/SL confirmation.',
          },
          $unset: {
            exitPrice: '',
            totalPoints: '',
            exitReason: '',
            exitTime: '',
          },
        }
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        scannedCount: candidates.length,
        repairCount: repairs.length,
        samples: repairs.slice(0, 50),
      },
      null,
      2
    )
  );
};

try {
  await run();
  process.exit(0);
} catch (error) {
  console.error('[RepairPrematureSignalExits] Failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  try {
    await mongoose.connection.close();
  } catch {
    // ignore
  }
}

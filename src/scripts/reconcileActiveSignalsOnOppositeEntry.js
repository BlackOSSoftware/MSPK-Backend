import mongoose from 'mongoose';

import connectDB from '../config/database.js';
import Signal from '../models/Signal.js';
import signalService from '../services/signal.service.js';

const hasFlag = (name) => process.argv.includes(`--${name}`);

const dryRun = hasFlag('dry-run') || hasFlag('dryrun');

const run = async () => {
  await connectDB();

  const signals = await Signal.find({})
    .sort({ signalTime: 1, createdAt: 1, _id: 1 })
    .select('_id symbol segment timeframe type entryPrice signalTime createdAt status')
    .lean();

  const repairedIds = new Set();
  const repairSamples = [];

  for (const signal of signals) {
    if (!signal?.symbol || !signal?.type) continue;

    if (dryRun) {
      const candidates = await Signal.find({
        _id: { $ne: signal._id },
        symbol: signal.symbol,
        segment: signal.segment,
        timeframe: signal.timeframe,
        status: { $in: ['Active', 'Open', 'Paused'] },
        type: { $ne: signal.type },
        $or: [
          { signalTime: { $lt: signal.signalTime || signal.createdAt } },
          {
            signalTime: { $exists: false },
            createdAt: { $lt: signal.signalTime || signal.createdAt },
          },
        ],
      })
        .select('_id symbol timeframe type entryPrice signalTime status')
        .lean();

      candidates.forEach((candidate) => {
        if (repairedIds.has(String(candidate._id))) return;
        repairedIds.add(String(candidate._id));
        if (repairSamples.length < 25) {
          repairSamples.push({
            repairedSignalId: String(candidate._id),
            repairedSymbol: candidate.symbol,
            repairedType: candidate.type,
            repairedSignalTime: candidate.signalTime || null,
            settlementEntrySignalId: String(signal._id),
            settlementType: signal.type,
            settlementSignalTime: signal.signalTime || signal.createdAt || null,
            settlementEntryPrice: signal.entryPrice,
          });
        }
      });
      continue;
    }

    const repairedSignals = await signalService.settleOppositeActiveSignalsForEntry({
      symbol: signal.symbol,
      segment: signal.segment,
      timeframe: signal.timeframe,
      type: signal.type,
      entryPrice: signal.entryPrice,
      signalTime: signal.signalTime || signal.createdAt,
      excludeSignalId: signal._id,
      skipSideEffects: true,
    });

    repairedSignals.forEach((repairedSignal) => {
      const repairedId = String(repairedSignal?._id || repairedSignal?.id || '');
      if (!repairedId || repairedIds.has(repairedId)) return;
      repairedIds.add(repairedId);

      if (repairSamples.length < 25) {
        repairSamples.push({
          repairedSignalId: repairedId,
          repairedSymbol: repairedSignal.symbol,
          repairedType: repairedSignal.type,
          repairedStatus: repairedSignal.status,
          repairedExitPrice: repairedSignal.exitPrice,
          repairedExitTime: repairedSignal.exitTime,
          repairedPoints: repairedSignal.totalPoints,
          settlementEntrySignalId: String(signal._id),
          settlementType: signal.type,
          settlementSignalTime: signal.signalTime || signal.createdAt || null,
          settlementEntryPrice: signal.entryPrice,
        });
      }
    });
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        totalSignalsScanned: signals.length,
        repairedCount: repairedIds.size,
        samples: repairSamples,
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
  console.error('[ReconcileActiveSignals] Failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  try {
    await mongoose.connection.close();
  } catch {
    // ignore
  }
}

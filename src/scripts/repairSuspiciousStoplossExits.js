import mongoose from 'mongoose';

import connectDB from '../config/database.js';
import Signal from '../models/Signal.js';
import {
  isStopLossExitPriceConsistent,
  normalizeExitWebhookPayload,
} from '../controllers/webhook.controller.js';

const hasFlag = (name) => process.argv.includes(`--${name}`);

const dryRun = !hasFlag('apply');

const run = async () => {
  await connectDB();

  const candidates = await Signal.find({
    status: 'Stoploss Hit',
    exitReason: { $regex: '(STOP|SL)', $options: 'i' },
    stopLoss: { $exists: true, $ne: null },
    exitPrice: { $exists: true, $ne: null },
  })
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .lean();

  const repairs = [];

  candidates.forEach((signal) => {
    if (
      isStopLossExitPriceConsistent({
        signal,
        exitPrice: signal.exitPrice,
      })
    ) {
      return;
    }

    const normalized = normalizeExitWebhookPayload({
      signal,
      exitReason: signal.exitReason || 'STOP_LOSS',
      exitPrice: signal.exitPrice,
      totalPoints: signal.totalPoints,
      exitTime: signal.exitTime,
      receivedAt: signal.updatedAt || signal.createdAt || new Date(),
      timeframeFromPayload: signal.timeframe,
    });

    repairs.push({
      signalId: String(signal._id),
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      type: signal.type,
      entryPrice: signal.entryPrice,
      oldExitPrice: signal.exitPrice,
      newExitPrice: normalized.exitPrice,
      oldExitTime: signal.exitTime,
      newExitTime: normalized.exitTime,
      oldPoints: signal.totalPoints,
      newPoints: normalized.totalPoints,
      oldExitReason: signal.exitReason,
      sanitizedFields: normalized.sanitizedFields,
    });
  });

  if (!dryRun) {
    for (const repair of repairs) {
      await Signal.updateOne(
        { _id: repair.signalId },
        {
          $set: {
            exitPrice: repair.newExitPrice,
            exitTime: repair.newExitTime,
            totalPoints: repair.newPoints,
            status: 'Stoploss Hit',
          },
        }
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        candidateCount: candidates.length,
        repairCount: repairs.length,
        samples: repairs.slice(0, 25),
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
  console.error('[RepairSuspiciousStoplossExits] Failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  try {
    await mongoose.connection.close();
  } catch {
    // ignore
  }
}

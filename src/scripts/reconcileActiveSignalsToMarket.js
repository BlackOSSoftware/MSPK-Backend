import mongoose from 'mongoose';

import connectDB from '../config/database.js';
import marketDataService from '../services/marketData.service.js';
import signalService from '../services/signal.service.js';

const readNumericArg = (name, fallback) => {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!match) return fallback;
  const parsed = Number.parseInt(match.split('=').slice(1).join('='), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const passes = Math.max(1, readNumericArg('passes', 3));
const waitMs = Math.max(0, readNumericArg('wait-ms', 4000));
const limit = Math.max(0, readNumericArg('limit', 0));

const run = async () => {
  await connectDB();
  await marketDataService.init();

  const summaries = [];
  const updatedIds = new Set();

  for (let attempt = 1; attempt <= passes; attempt += 1) {
    if (attempt > 1 && waitMs > 0) {
      await sleep(waitMs);
    }

    const result = await signalService.reconcileActiveSignalsWithMarketData({
      limit,
      fetchLatestQuotes: true,
    });

    result.updatedSignals.forEach((signal) => {
      const signalId = String(signal?._id || signal?.id || '').trim();
      if (signalId) {
        updatedIds.add(signalId);
      }
    });

    summaries.push({
      pass: attempt,
      scannedCount: result.scannedCount,
      closedCount: result.closedCount,
      updatedSignalIds: result.updatedSignals.map((signal) => String(signal?._id || signal?.id || '')),
    });
  }

  console.log(
    JSON.stringify(
      {
        passes,
        waitMs,
        limit,
        totalUpdatedSignals: updatedIds.size,
        summaries,
      },
      null,
      2
    )
  );
};

try {
  await run();
  process.exitCode = 0;
} catch (error) {
  console.error('[ReconcileActiveSignalsToMarket] Failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  try {
    await mongoose.connection.close();
  } catch {
    // ignore close failures
  }

  process.exit(process.exitCode || 0);
}

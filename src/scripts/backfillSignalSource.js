import mongoose from 'mongoose';

import connectDB from '../config/database.js';
import Signal from '../models/Signal.js';

const hasFlag = (name) => process.argv.includes(`--${name}`);
const apply = hasFlag('apply');

const resolveSource = (signal = {}) => {
  const existing = String(signal?.source || '').trim().toUpperCase();
  if (['TRADINGVIEW', 'MANUAL', 'SYSTEM'].includes(existing)) {
    return existing;
  }

  const webhookId = String(signal?.webhookId || '').trim();
  const uniqueId = String(signal?.uniqueId || '').trim();

  if (webhookId) return 'TRADINGVIEW';
  if (/^ENTRY\|/i.test(uniqueId)) return 'TRADINGVIEW';
  return 'MANUAL';
};

const run = async () => {
  await connectDB();

  const signals = await Signal.find({})
    .select('_id source webhookId uniqueId createdAt')
    .lean();

  const planned = signals
    .map((signal) => ({
      id: signal._id,
      current: String(signal?.source || '').trim().toUpperCase() || null,
      next: resolveSource(signal),
      webhookId: signal?.webhookId || '',
      uniqueId: signal?.uniqueId || '',
    }))
    .filter((item) => item.current !== item.next);

  if (apply && planned.length > 0) {
    const bulk = planned.map((item) => ({
      updateOne: {
        filter: { _id: item.id },
        update: { $set: { source: item.next } },
      },
    }));
    await Signal.bulkWrite(bulk, { ordered: false });
  }

  console.log(
    JSON.stringify(
      {
        apply,
        totalSignals: signals.length,
        updatesPlanned: planned.length,
        sample: planned.slice(0, 25),
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
  console.error('[BackfillSignalSource] Failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  try {
    await mongoose.connection.close();
  } catch {
    // ignore
  }
}

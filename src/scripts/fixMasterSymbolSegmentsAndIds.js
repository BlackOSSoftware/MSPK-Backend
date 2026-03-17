import mongoose from 'mongoose';

import config from '../config/config.js';
import connectDB from '../config/database.js';
import MasterSymbol from '../models/MasterSymbol.js';
import { buildMasterSymbolId } from '../utils/masterSymbolId.js';
import { resolveSymbolSegmentGroup } from '../utils/marketSegmentResolver.js';

const CONFIRM_TOKEN = 'FIX_SYMBOL_SEGMENTS_AND_IDS';

const hasFlag = (name) => process.argv.includes(`--${name}`);

const getArg = (name) => {
  const prefix = `--${name}=`;
  const byEquals = process.argv.find((arg) => arg.startsWith(prefix));
  if (byEquals) return byEquals.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
};

const sanitizeMongoUri = (value) => {
  if (!value) return '';
  return value.replace(
    /^(mongodb(?:\+srv)?:\/\/)([^@/]+@)(.+)$/i,
    (_, scheme, _creds, rest) => `${scheme}<redacted>@${rest}`
  );
};

const dryRun = hasFlag('dry-run') || hasFlag('dryrun');
const confirm = getArg('confirm');
const limitArg = getArg('limit');
const limit = limitArg ? Number.parseInt(limitArg, 10) : null;

if (!dryRun && confirm !== CONFIRM_TOKEN) {
  console.error('[FixMasterSymbols] Refusing to update DB without explicit confirmation.');
  console.error(`[FixMasterSymbols] Dry run: node src/scripts/fixMasterSymbolSegmentsAndIds.js --dry-run`);
  console.error(
    `[FixMasterSymbols] Apply:   node src/scripts/fixMasterSymbolSegmentsAndIds.js --confirm ${CONFIRM_TOKEN}`
  );
  process.exit(1);
}

const normalizeUpper = (value) => String(value ?? '').trim().toUpperCase();

const run = async () => {
  console.log(`[FixMasterSymbols] NODE_ENV=${config.env}`);
  console.log(`[FixMasterSymbols] MONGO_URI=${sanitizeMongoUri(config?.mongoose?.url)}`);

  await connectDB();

  const filter = {};
  if (hasFlag('only-active')) filter.isActive = true;
  if (hasFlag('only-watchlist')) filter.isWatchlist = true;

  const cursor = MasterSymbol.find(filter).sort({ _id: 1 }).cursor();

  let total = 0;
  let touched = 0;
  let segmentChanged = 0;
  let symbolIdChanged = 0;

  const samples = [];
  let ops = [];

  const flush = async () => {
    if (dryRun) return;
    if (ops.length === 0) return;
    const batch = ops;
    ops = [];
    await MasterSymbol.bulkWrite(batch, { ordered: false });
  };

  for await (const doc of cursor) {
    total += 1;
    if (limit && total > limit) break;

    const currentSegment = normalizeUpper(doc.segment);
    const desiredSegment = normalizeUpper(resolveSymbolSegmentGroup(doc.toObject()));
    const nextSegment = desiredSegment || currentSegment || 'OTHER';

    const currentSymbolId = String(doc.symbolId || '').trim();
    const nextSymbolId = buildMasterSymbolId({
      _id: doc._id,
      segment: nextSegment,
      symbol: doc.symbol,
    });

    const updates = {};
    if (currentSegment !== nextSegment) {
      updates.segment = nextSegment;
      segmentChanged += 1;
    }

    if (currentSymbolId !== nextSymbolId) {
      updates.symbolId = nextSymbolId;
      symbolIdChanged += 1;
    }

    if (Object.keys(updates).length === 0) continue;

    touched += 1;
    if (samples.length < 25) {
      samples.push({
        symbol: doc.symbol,
        exchange: doc.exchange,
        provider: doc.provider,
        fromSegment: currentSegment,
        toSegment: nextSegment,
        fromSymbolId: currentSymbolId || null,
        toSymbolId: nextSymbolId,
      });
    }

    if (dryRun) continue;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: updates },
      },
    });

    if (ops.length >= 500) {
      await flush();
    }
  }

  await flush();

  console.log('[FixMasterSymbols] Summary:', JSON.stringify({
    matched: total,
    touched,
    segmentChanged,
    symbolIdChanged,
    dryRun,
    limit: limit || null,
  }, null, 2));

  if (samples.length > 0) {
    console.log('[FixMasterSymbols] Sample updates:', JSON.stringify(samples, null, 2));
  } else {
    console.log('[FixMasterSymbols] No changes needed.');
  }

  if (dryRun) {
    console.log(
      `[FixMasterSymbols] Dry run complete. To apply changes: node src/scripts/fixMasterSymbolSegmentsAndIds.js --confirm ${CONFIRM_TOKEN}`
    );
  }
};

try {
  await run();
  process.exit(0);
} catch (error) {
  console.error('[FixMasterSymbols] Failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  try {
    await mongoose.connection.close();
  } catch {
    // ignore
  }
}

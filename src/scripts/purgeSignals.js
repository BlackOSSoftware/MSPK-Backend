import mongoose from 'mongoose';

import config from '../config/config.js';
import connectDB from '../config/database.js';
import Signal from '../models/Signal.js';
import Watchlist from '../models/Watchlist.js';

const CONFIRM_TOKEN = 'DELETE_ALL_SIGNALS';

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

if (!dryRun && confirm !== CONFIRM_TOKEN) {
  console.error('[PurgeSignals] Refusing to run without explicit confirmation.');
  console.error(`[PurgeSignals] Run: node src/scripts/purgeSignals.js --confirm ${CONFIRM_TOKEN}`);
  console.error('[PurgeSignals] Tip: use --dry-run first to preview counts.');
  process.exit(1);
}

const run = async () => {
  console.log(`[PurgeSignals] NODE_ENV=${config.env}`);
  console.log(`[PurgeSignals] MONGO_URI=${sanitizeMongoUri(config?.mongoose?.url)}`);

  await connectDB();

  const existingSignals = await Signal.countDocuments();
  const watchlistsWithSignals = await Watchlist.countDocuments({ 'signals.0': { $exists: true } });

  console.log(`[PurgeSignals] Signals in DB: ${existingSignals}`);
  console.log(`[PurgeSignals] Watchlists with signals: ${watchlistsWithSignals}`);

  if (dryRun) {
    console.log('[PurgeSignals] Dry run enabled. No changes were made.');
    return;
  }

  const [signalDeleteResult, watchlistClearResult] = await Promise.all([
    Signal.deleteMany({}),
    Watchlist.updateMany({ 'signals.0': { $exists: true } }, { $set: { signals: [] } }),
  ]);

  console.log(`[PurgeSignals] Deleted signals: ${signalDeleteResult.deletedCount || 0}`);
  console.log(`[PurgeSignals] Cleared watchlists: ${watchlistClearResult.modifiedCount || 0}`);
};

try {
  await run();
  process.exit(0);
} catch (error) {
  console.error('[PurgeSignals] Failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  try {
    await mongoose.connection.close();
  } catch {
    // ignore
  }
}


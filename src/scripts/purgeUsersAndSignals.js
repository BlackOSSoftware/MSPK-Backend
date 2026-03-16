import mongoose from 'mongoose';

import config from '../config/config.js';
import connectDB from '../config/database.js';
import Signal from '../models/Signal.js';
import User from '../models/User.js';
import Watchlist from '../models/Watchlist.js';

const CONFIRM_TOKEN = 'DELETE_ALL_USERS_AND_SIGNALS';

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
  console.error('[PurgeUsersAndSignals] Refusing to run without explicit confirmation.');
  console.error(
    `[PurgeUsersAndSignals] Run: node src/scripts/purgeUsersAndSignals.js --confirm ${CONFIRM_TOKEN}`
  );
  console.error('[PurgeUsersAndSignals] Tip: use --dry-run first to preview counts.');
  process.exit(1);
}

const run = async () => {
  console.log(`[PurgeUsersAndSignals] NODE_ENV=${config.env}`);
  console.log(`[PurgeUsersAndSignals] MONGO_URI=${sanitizeMongoUri(config?.mongoose?.url)}`);

  await connectDB();

  const [existingUsers, existingSignals, watchlistsWithSignals] = await Promise.all([
    User.countDocuments(),
    Signal.countDocuments(),
    Watchlist.countDocuments({ 'signals.0': { $exists: true } }),
  ]);

  console.log(`[PurgeUsersAndSignals] Users in DB: ${existingUsers}`);
  console.log(`[PurgeUsersAndSignals] Signals in DB: ${existingSignals}`);
  console.log(`[PurgeUsersAndSignals] Watchlists with signals: ${watchlistsWithSignals}`);

  if (dryRun) {
    console.log('[PurgeUsersAndSignals] Dry run enabled. No changes were made.');
    return;
  }

  const [signalDeleteResult, watchlistClearResult, userDeleteResult] = await Promise.all([
    Signal.deleteMany({}),
    Watchlist.updateMany({ 'signals.0': { $exists: true } }, { $set: { signals: [] } }),
    User.deleteMany({}),
  ]);

  console.log(`[PurgeUsersAndSignals] Deleted signals: ${signalDeleteResult.deletedCount || 0}`);
  console.log(`[PurgeUsersAndSignals] Cleared watchlists: ${watchlistClearResult.modifiedCount || 0}`);
  console.log(`[PurgeUsersAndSignals] Deleted users: ${userDeleteResult.deletedCount || 0}`);
};

try {
  await run();
  process.exit(0);
} catch (error) {
  console.error('[PurgeUsersAndSignals] Failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  try {
    await mongoose.connection.close();
  } catch {
    // ignore
  }
}


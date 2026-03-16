import mongoose from 'mongoose';

import config from '../config/config.js';
import connectDB from '../config/database.js';
import logger from '../config/log.js';
import Setting from '../models/Setting.js';
import MasterSymbol from '../models/MasterSymbol.js';
import { decrypt } from '../utils/encryption.js';
import { buildMasterSymbolId } from '../utils/masterSymbolId.js';
import { kiteService } from '../services/kite.service.js';

const hasFlag = (name) => process.argv.includes(`--${name}`);

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toUpper = (value) => String(value ?? '').trim().toUpperCase();

const parseExpiry = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const sanitizeMongoUri = (value) => {
  if (!value) return '';
  return value.replace(
    /^(mongodb(?:\+srv)?:\/\/)([^@/]+@)(.+)$/i,
    (_, scheme, _creds, rest) => `${scheme}<redacted>@${rest}`
  );
};

const loadKiteCredentials = async () => {
  const fromEnv = {
    apiKey: String(process.env.KITE_API_KEY || '').trim(),
    apiSecret: String(process.env.KITE_API_SECRET || '').trim(),
    accessToken: String(process.env.KITE_ACCESS_TOKEN || '').trim(),
  };

  if (fromEnv.apiKey && fromEnv.apiSecret) {
    return fromEnv;
  }

  const settings = await Setting.find({
    key: { $in: ['kite_api_key', 'kite_api_secret', 'kite_access_token'] },
  }).lean();

  const byKey = new Map(settings.map((item) => [String(item.key), item.value]));

  const apiKey = fromEnv.apiKey || String(decrypt(byKey.get('kite_api_key')) || '').trim();
  const apiSecret = fromEnv.apiSecret || String(decrypt(byKey.get('kite_api_secret')) || '').trim();
  const accessToken =
    fromEnv.accessToken || String(decrypt(byKey.get('kite_access_token')) || '').trim();

  return { apiKey, apiSecret, accessToken };
};

const run = async () => {
  const dryRun = hasFlag('dry-run') || hasFlag('dryrun');

  logger.info(`[SyncMcxRoots] NODE_ENV=${config.env}`);
  logger.info(`[SyncMcxRoots] MONGO_URI=${sanitizeMongoUri(config?.mongoose?.url)}`);
  logger.info(`[SyncMcxRoots] Mode=${dryRun ? 'dry-run' : 'write'}`);

  await connectDB();

  const { apiKey, apiSecret, accessToken } = await loadKiteCredentials();
  if (!apiKey || !apiSecret) {
    throw new Error('Missing Kite credentials. Set KITE_API_KEY/KITE_API_SECRET or store kite_api_key/kite_api_secret in Settings.');
  }

  kiteService.initialize(apiKey, apiSecret);
  if (accessToken) {
    kiteService.setAccessToken(accessToken);
  }

  const instruments = await kiteService.getInstruments();
  const roots = new Map(); // nameKey -> list of contracts

  for (const inst of Array.isArray(instruments) ? instruments : []) {
    const exchange = toUpper(inst?.exchange);
    if (exchange !== 'MCX') continue;

    const instrumentType = toUpper(inst?.instrument_type || inst?.instrumentType);
    const segment = toUpper(inst?.segment);
    const isFut = instrumentType.includes('FUT') || segment.includes('FUT');
    if (!isFut) continue;

    const nameKey = toUpper(inst?.name);
    if (!nameKey) continue;

    if (!roots.has(nameKey)) roots.set(nameKey, []);
    roots.get(nameKey).push({
      tradingsymbol: toUpper(inst?.tradingsymbol),
      instrumentToken: String(inst?.instrument_token ?? inst?.instrumentToken ?? '').trim(),
      expiry: parseExpiry(inst?.expiry),
      lotSize: parseNumber(inst?.lot_size, 1),
      tickSize: parseNumber(inst?.tick_size, 0.05),
    });
  }

  const now = new Date();
  const rootList = Array.from(roots.entries())
    .map(([nameKey, contracts]) => {
      const sorted = [...contracts].sort((left, right) => {
        const lt = left.expiry ? left.expiry.getTime() : Number.POSITIVE_INFINITY;
        const rt = right.expiry ? right.expiry.getTime() : Number.POSITIVE_INFINITY;
        return lt - rt;
      });
      const picked = sorted.find((item) => item.expiry && item.expiry >= now) || sorted[0] || null;
      return {
        nameKey,
        picked,
        contracts: sorted.length,
      };
    })
    .filter((item) => item.picked)
    .sort((a, b) => a.nameKey.localeCompare(b.nameKey));

  logger.info(`[SyncMcxRoots] Found MCX futures roots: ${rootList.length}`);

  if (dryRun) {
    logger.info('[SyncMcxRoots] Dry run enabled. No changes were made.');
    logger.info(`[SyncMcxRoots] Sample: ${rootList.slice(0, 40).map((item) => item.nameKey).join(', ')}`);
    return;
  }

  let upserted = 0;
  let symbolIdsCreated = 0;

  for (const root of rootList) {
    const symbol = `MCX:${root.nameKey}`;
    const picked = root.picked;

    const update = {
      symbol,
      segment: 'COMMODITY',
      exchange: 'MCX',
      provider: 'kite',
      isActive: true,
      lotSize: picked?.lotSize || 1,
      tickSize: picked?.tickSize || 0.05,
    };

    const doc = await MasterSymbol.findOneAndUpdate(
      { symbol },
      {
        $set: update,
        $setOnInsert: {
          name: root.nameKey,
          isWatchlist: false,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    upserted += 1;

    if (!doc.symbolId) {
      doc.symbolId = buildMasterSymbolId(doc);
      await doc.save();
      symbolIdsCreated += 1;
    }
  }

  const finalCount = await MasterSymbol.countDocuments({ exchange: 'MCX' });
  logger.info(`[SyncMcxRoots] Upserted roots: ${upserted}`);
  logger.info(`[SyncMcxRoots] Created missing symbolId: ${symbolIdsCreated}`);
  logger.info(`[SyncMcxRoots] Total MCX symbols in DB now: ${finalCount}`);
};

try {
  await run();
  process.exit(0);
} catch (error) {
  console.error('[SyncMcxRoots] Failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  try {
    await mongoose.connection.close();
  } catch {
    // ignore
  }
}

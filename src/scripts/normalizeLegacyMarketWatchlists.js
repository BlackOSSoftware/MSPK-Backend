import mongoose from 'mongoose';
import config from '../config/config.js';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import logger from '../config/log.js';
import { isUnsupportedWatchlistSymbol } from '../utils/marketSymbolAliases.js';

const stripUnsupportedSymbols = (values = []) => {
  if (!Array.isArray(values)) return [];

  const next = [];
  const seen = new Set();

  for (const value of values) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized || seen.has(normalized) || isUnsupportedWatchlistSymbol(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }

  return next;
};

const isSameList = (left = [], right = []) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const run = async () => {
  await mongoose.connect(config.mongoose.url);

  let updatedUsers = 0;
  let removedSymbols = 0;

  const users = await User.find({
    $or: [
      { marketWatchlist: { $in: ['XPDUSD'] } },
      { 'marketWatchlists.symbols': { $in: ['XPDUSD'] } },
      { 'marketWatchlists.customSymbols': { $in: ['XPDUSD'] } },
    ],
  });

  for (const user of users) {
    let changed = false;

    const nextMarketWatchlist = stripUnsupportedSymbols(user.marketWatchlist);
    if (!isSameList(nextMarketWatchlist, user.marketWatchlist || [])) {
      removedSymbols += Math.max(0, (user.marketWatchlist || []).length - nextMarketWatchlist.length);
      user.marketWatchlist = nextMarketWatchlist;
      changed = true;
    }

    const nextWatchlists = (Array.isArray(user.marketWatchlists) ? user.marketWatchlists : []).map((watchlist) => {
      const nextSymbols = stripUnsupportedSymbols(watchlist?.symbols);
      const nextCustomSymbols = stripUnsupportedSymbols(watchlist?.customSymbols);
      const listChanged =
        !isSameList(nextSymbols, Array.isArray(watchlist?.symbols) ? watchlist.symbols : []) ||
        !isSameList(nextCustomSymbols, Array.isArray(watchlist?.customSymbols) ? watchlist.customSymbols : []);

      if (!listChanged) return watchlist;

      removedSymbols += Math.max(0, (Array.isArray(watchlist?.symbols) ? watchlist.symbols.length : 0) - nextSymbols.length);
      removedSymbols += Math.max(0, (Array.isArray(watchlist?.customSymbols) ? watchlist.customSymbols.length : 0) - nextCustomSymbols.length);

      changed = true;
      return {
        ...watchlist,
        symbols: nextSymbols,
        customSymbols: nextCustomSymbols,
        updatedAt: new Date(),
      };
    });

    if (changed) {
      user.marketWatchlists = nextWatchlists;
      await user.save();
      updatedUsers += 1;
    }
  }

  let updatedSettings = 0;
  const settings = await Setting.find({ value: { $in: ['XPDUSD'] } });
  for (const setting of settings) {
    const nextValue = stripUnsupportedSymbols(setting.value);
    if (isSameList(nextValue, Array.isArray(setting.value) ? setting.value : [])) {
      continue;
    }
    removedSymbols += Math.max(0, (Array.isArray(setting.value) ? setting.value.length : 0) - nextValue.length);
    setting.value = nextValue;
    await setting.save();
    updatedSettings += 1;
  }

  console.log(
    JSON.stringify(
      {
        updatedUsers,
        updatedSettings,
        removedSymbols,
      },
      null,
      2
    )
  );
};

run()
  .catch((error) => {
    logger.error(`normalizeLegacyMarketWatchlists failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (error) {
      logger.warn(`normalizeLegacyMarketWatchlists disconnect failed: ${error.message}`);
    }
  });

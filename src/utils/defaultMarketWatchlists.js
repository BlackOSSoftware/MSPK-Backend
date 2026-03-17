import mongoose from 'mongoose';
import Setting from '../models/Setting.js';
import { normalizeSelectedSymbols } from './userSignalSelection.js';

const DEFAULT_MARKET_WATCHLIST_NAME = 'My Watchlist';

const DEFAULT_NEW_USER_WATCHLIST_SYMBOLS = [
  'BTCUSD',
  'NSE:NIFTY 50-INDEX',
  'USDINR',
  'NSE:RELIANCE',
  'NSE:HDFCBANK',
];

const createMarketWatchlistId = () => new mongoose.Types.ObjectId().toHexString();
const DEFAULT_NEW_USER_WATCHLIST_SETTING_KEY = 'default_market_watchlist_symbols';

const buildDefaultUserMarketWatchlistState = (
  symbols = DEFAULT_NEW_USER_WATCHLIST_SYMBOLS
) => {
  const normalizedSymbols = normalizeSelectedSymbols(symbols);
  const now = new Date();
  const activeWatchlistId = createMarketWatchlistId();

  return {
    marketWatchlist: normalizedSymbols,
    marketWatchlists: [
      {
        id: activeWatchlistId,
        name: DEFAULT_MARKET_WATCHLIST_NAME,
        symbols: normalizedSymbols,
        customSymbols: [],
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    activeMarketWatchlistId: activeWatchlistId,
  };
};

const resolveDefaultNewUserWatchlistSymbols = async () => {
  const setting = await Setting.findOne({ key: DEFAULT_NEW_USER_WATCHLIST_SETTING_KEY })
    .select('value')
    .lean();

  const configuredSymbols = normalizeSelectedSymbols(setting?.value);
  if (configuredSymbols.length > 0) {
    return configuredSymbols;
  }

  return normalizeSelectedSymbols(DEFAULT_NEW_USER_WATCHLIST_SYMBOLS);
};

export {
  DEFAULT_MARKET_WATCHLIST_NAME,
  DEFAULT_NEW_USER_WATCHLIST_SYMBOLS,
  DEFAULT_NEW_USER_WATCHLIST_SETTING_KEY,
  buildDefaultUserMarketWatchlistState,
  resolveDefaultNewUserWatchlistSymbols,
};

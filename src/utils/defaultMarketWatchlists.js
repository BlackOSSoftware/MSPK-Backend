import mongoose from 'mongoose';
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
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    activeMarketWatchlistId: activeWatchlistId,
  };
};

export {
  DEFAULT_MARKET_WATCHLIST_NAME,
  DEFAULT_NEW_USER_WATCHLIST_SYMBOLS,
  buildDefaultUserMarketWatchlistState,
};

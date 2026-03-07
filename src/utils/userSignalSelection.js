const MAX_SELECTED_SYMBOLS_PER_SEGMENT = 10;

const normalizeSelectedSymbols = (symbols = []) =>
  Array.from(
    new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map((symbol) => String(symbol || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );

const buildSelectedSymbolDocsMap = (symbolDocs = []) =>
  new Map(
    (Array.isArray(symbolDocs) ? symbolDocs : [])
      .map((doc) => [String(doc?.symbol || '').trim().toUpperCase(), doc])
      .filter(([symbol]) => Boolean(symbol))
  );

const getSelectionBucketKey = (symbolDoc = {}) =>
  String(symbolDoc?.segment || symbolDoc?.exchange || 'OTHER').trim().toUpperCase() || 'OTHER';

const limitSelectedSymbolsPerSegment = (
  symbols = [],
  symbolDocsBySymbol = new Map(),
  maxPerSegment = MAX_SELECTED_SYMBOLS_PER_SEGMENT
) => {
  const normalizedSymbols = normalizeSelectedSymbols(symbols);
  if (normalizedSymbols.length === 0) return [];

  const segmentCounts = new Map();
  const selectedSymbols = [];

  for (const symbol of normalizedSymbols) {
    const segmentKey = getSelectionBucketKey(symbolDocsBySymbol.get(symbol));
    const count = segmentCounts.get(segmentKey) || 0;
    if (count >= maxPerSegment) continue;

    segmentCounts.set(segmentKey, count + 1);
    selectedSymbols.push(symbol);
  }

  return selectedSymbols;
};

const getUserSelectedSymbols = (user, symbolDocsBySymbol = null) =>
  symbolDocsBySymbol instanceof Map
    ? limitSelectedSymbolsPerSegment(user?.marketWatchlist, symbolDocsBySymbol)
    : normalizeSelectedSymbols(user?.marketWatchlist);

const buildSelectedSignalFilter = (symbols = []) => {
  const selectedSymbols = normalizeSelectedSymbols(symbols);
  if (selectedSymbols.length === 0) {
    return { _id: { $in: [] } };
  }

  return { symbol: { $in: selectedSymbols } };
};

const hasSelectedSignalSymbol = (symbols = [], signalSymbol = '') => {
  const normalizedSignal = String(signalSymbol || '').trim().toUpperCase();
  if (!normalizedSignal) return false;

  return normalizeSelectedSymbols(symbols).includes(normalizedSignal);
};

export {
  MAX_SELECTED_SYMBOLS_PER_SEGMENT,
  buildSelectedSignalFilter,
  buildSelectedSymbolDocsMap,
  getUserSelectedSymbols,
  hasSelectedSignalSymbol,
  limitSelectedSymbolsPerSegment,
  normalizeSelectedSymbols,
};

import { normalizeUpper } from './marketSegmentResolver.js';

const DEDUPE_SUFFIX_PATTERN = /(\.PR|\.X)$/i;

const getDedupeBaseSymbol = (symbolLike = {}) => {
  const normalized = normalizeUpper(symbolLike?.symbol ?? symbolLike);
  if (!normalized) return '';

  const exchange = normalizeUpper(symbolLike?.exchange);
  const segment = normalizeUpper(symbolLike?.segmentGroup || symbolLike?.segment);
  const shouldStrip = (exchange === 'FOREX' || segment === 'CURRENCY') && DEDUPE_SUFFIX_PATTERN.test(normalized);

  return shouldStrip ? normalized.replace(DEDUPE_SUFFIX_PATTERN, '') : normalized;
};

const getDedupeRank = (item = {}) => {
  const exchange = normalizeUpper(item.exchange);
  const segment = normalizeUpper(item.segmentGroup || item.segment);
  const symbol = normalizeUpper(item.symbol);

  if (exchange === 'COMEX' || segment === 'COMEX') return 0;
  if (segment === 'COMMODITY') return 1;
  if (exchange === 'FOREX' || segment === 'CURRENCY') {
    if (symbol.endsWith('.X')) return 2;
    if (symbol.endsWith('.PR')) return 3;
    return 4;
  }
  return 5;
};

const shouldReplace = (current, candidate) => {
  const rankCurrent = getDedupeRank(current);
  const rankCandidate = getDedupeRank(candidate);
  if (rankCandidate < rankCurrent) return true;
  if (rankCandidate > rankCurrent) return false;

  const currentHasId = Boolean(current?.symbolId);
  const candidateHasId = Boolean(candidate?.symbolId);
  if (candidateHasId && !currentHasId) return true;
  if (currentHasId && !candidateHasId) return false;

  const currentLen = String(current?.symbol || '').length;
  const candidateLen = String(candidate?.symbol || '').length;
  if (candidateLen && currentLen && candidateLen < currentLen) return true;

  return false;
};

const dedupeSymbols = (items = []) => {
  const map = new Map();
  const passthrough = [];

  for (const item of items) {
    const keyBase = getDedupeBaseSymbol(item);
    if (!keyBase) {
      passthrough.push(item);
      continue;
    }
    const existing = map.get(keyBase);
    if (!existing) {
      map.set(keyBase, item);
      continue;
    }
    if (shouldReplace(existing, item)) {
      map.set(keyBase, item);
    }
  }

  return [...map.values(), ...passthrough];
};

export { dedupeSymbols, getDedupeBaseSymbol };

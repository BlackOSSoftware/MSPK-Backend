import mongoose from 'mongoose';
import MasterSymbol from '../models/MasterSymbol.js';
import { expandSelectedSymbols } from './userSignalSelection.js';
import { hasExplicitContractMonth } from './currentMonthContracts.js';
import { looksLikeMasterSymbolId } from './masterSymbolId.js';

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeLookupValue = (value = '') => String(value || '').trim().toUpperCase();

const buildAliasSet = (value = '') => {
  const normalized = normalizeLookupValue(value);
  if (!normalized) return new Set();

  return new Set([normalized, ...expandSelectedSymbols([normalized]).map((item) => normalizeLookupValue(item))]);
};

const isDerivativeLikeValue = (value = '') => {
  const normalized = normalizeLookupValue(value);
  if (!normalized) return false;

  return (
    hasExplicitContractMonth({ symbol: normalized, sourceSymbol: normalized, name: normalized }) ||
    /(FUT|OPT|CE|PE)\b/.test(normalized)
  );
};

const isIndexLikeValue = (value = '') => {
  const normalized = normalizeLookupValue(value);
  if (!normalized) return false;

  return /(BANKNIFTY|FINNIFTY|NIFTY|INDIAVIX|INDIA VIX|MIDCPNIFTY|SENSEX|BANKEX|INDEX)/.test(normalized);
};

const isIndexLikeDoc = (doc = {}) => {
  const symbol = normalizeLookupValue(doc?.symbol);
  const sourceSymbol = normalizeLookupValue(doc?.sourceSymbol);
  const name = normalizeLookupValue(doc?.name);
  const segment = normalizeLookupValue(doc?.segment);

  return (
    segment === 'INDICES' ||
    symbol.includes('-INDEX') ||
    sourceSymbol.includes('-INDEX') ||
    name.includes('INDEX') ||
    isIndexLikeValue(symbol) ||
    isIndexLikeValue(sourceSymbol)
  );
};

const scoreMasterSymbolCandidate = (rawInput, candidate = {}, { symbolIdRequested = false } = {}) => {
  const raw = String(rawInput || '').trim();
  const normalizedRaw = normalizeLookupValue(raw);
  if (!normalizedRaw) return Number.NEGATIVE_INFINITY;

  const symbolIdLookupRequested = symbolIdRequested || looksLikeMasterSymbolId(normalizedRaw);
  const aliases = buildAliasSet(normalizedRaw);
  const symbol = normalizeLookupValue(candidate?.symbol);
  const sourceSymbol = normalizeLookupValue(candidate?.sourceSymbol);
  const name = normalizeLookupValue(candidate?.name);
  const symbolId = normalizeLookupValue(candidate?.symbolId);
  const candidateId = String(candidate?._id || '').trim();
  const rawLooksDerivative = isDerivativeLikeValue(normalizedRaw);
  const rawLooksIndex = !rawLooksDerivative && Array.from(aliases).some(isIndexLikeValue);
  const candidateIsDerivative = hasExplicitContractMonth(candidate);
  const candidateIsIndex = isIndexLikeDoc(candidate);

  let score = 0;

  if (symbolIdLookupRequested && symbolId && symbolId === normalizedRaw) score += 10000;
  if (mongoose.Types.ObjectId.isValid(raw) && candidateId === raw) score += 9500;

  if (symbol && symbol === normalizedRaw) score += 5000;
  else if (symbol && aliases.has(symbol)) score += 4300;

  if (sourceSymbol && sourceSymbol === normalizedRaw) score += 3200;
  else if (sourceSymbol && aliases.has(sourceSymbol)) score += 2600;

  if (name && name === normalizedRaw) score += 2200;

  if (rawLooksIndex) {
    if (candidateIsIndex) score += 900;
    if (candidateIsDerivative) score -= 900;
  }

  if (rawLooksDerivative) {
    if (candidateIsDerivative) score += 700;
    if (!candidateIsDerivative) score -= 400;
  }

  if (candidate?.isActive !== false) score += 50;

  return score;
};

const pickBestMasterSymbol = (rawInput, candidates = [], options = {}) => {
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const score = scoreMasterSymbolCandidate(rawInput, candidate, options);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
};

const findMasterSymbolCandidates = async (rawInput, { symbolIdRequested = false } = {}) => {
  const raw = String(rawInput || '').trim();
  const normalizedRaw = normalizeLookupValue(raw);
  if (!normalizedRaw) return [];

  const symbolIdLookupRequested = symbolIdRequested || looksLikeMasterSymbolId(normalizedRaw);
  const aliases = Array.from(buildAliasSet(normalizedRaw));
  const filters = [
    { symbol: { $in: aliases } },
    { sourceSymbol: { $in: aliases } },
    { name: new RegExp(`^${escapeRegex(raw)}$`, 'i') },
  ];

  if (symbolIdLookupRequested) {
    filters.unshift({ symbolId: new RegExp(`^${escapeRegex(raw)}$`, 'i') });
  }

  if (mongoose.Types.ObjectId.isValid(raw)) {
    filters.unshift({ _id: raw });
  }

  return MasterSymbol.find({ $or: filters })
    .select('_id symbol symbolId name segment exchange sourceSymbol isActive')
    .lean();
};

const resolveBestMasterSymbol = async (rawInput, options = {}) => {
  const candidates = await findMasterSymbolCandidates(rawInput, options);
  return pickBestMasterSymbol(rawInput, candidates, options);
};

export {
  buildAliasSet,
  findMasterSymbolCandidates,
  normalizeLookupValue,
  pickBestMasterSymbol,
  resolveBestMasterSymbol,
  scoreMasterSymbolCandidate,
};

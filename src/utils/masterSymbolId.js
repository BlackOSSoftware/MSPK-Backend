import {
  hasExplicitContractMonth,
  isCurrentMonthContractDoc,
} from './currentMonthContracts.js';

const FUTURE_CONTRACT_ROOT_REGEX = /^([A-Z0-9]+?)(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)FUT$/i;
const LEGACY_MASTER_SYMBOL_ID_REGEX = /-[a-f0-9]{24}$/i;
const STABLE_FRONT_MONTH_MASTER_SYMBOL_ID_REGEX = /^(?:[A-Z0-9]+-){3,}CURRENT$/i;

const sanitizeSymbolIdPart = (value, fallback = 'NA') => {
  const sanitized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized || fallback;
};

const normalizeSymbolIdValue = (value = '') => String(value ?? '').trim().toUpperCase();

const getStableFrontMonthFutureIdParts = (symbolDoc = {}, referenceDate = new Date()) => {
  if (!hasExplicitContractMonth(symbolDoc, referenceDate)) return null;
  if (!isCurrentMonthContractDoc(symbolDoc, referenceDate)) return null;

  const normalizedSymbol = normalizeSymbolIdValue(symbolDoc.symbol || symbolDoc.sourceSymbol);
  if (!normalizedSymbol.endsWith('FUT')) return null;

  const symbolParts = normalizedSymbol.split(':');
  const exchangeFromSymbol = symbolParts.length > 1 ? symbolParts.shift() : '';
  const tradingSymbol = symbolParts.length > 0 ? symbolParts.join(':') : normalizedSymbol;
  const match = tradingSymbol.match(FUTURE_CONTRACT_ROOT_REGEX);
  if (!match) return null;

  return {
    segment: sanitizeSymbolIdPart(symbolDoc.segment, 'SEG'),
    exchange: sanitizeSymbolIdPart(symbolDoc.exchange || exchangeFromSymbol, 'EXCH'),
    root: sanitizeSymbolIdPart(match[1], 'FUT'),
  };
};

const buildStableFrontMonthFutureSymbolId = (symbolDoc = {}, options = {}) => {
  const parts = getStableFrontMonthFutureIdParts(symbolDoc, options.referenceDate);
  if (!parts) return '';

  return `${parts.segment}-${parts.exchange}-${parts.root}-CURRENT`;
};

const buildLegacyMasterSymbolId = (symbolDoc = {}) => {
  const mongoId = String(symbolDoc?._id || '').trim();
  if (!mongoId) return '';

  const segment = sanitizeSymbolIdPart(symbolDoc.segment, 'SEG');
  const symbol = sanitizeSymbolIdPart(symbolDoc.symbol, 'SYMBOL');

  return `${segment}-${symbol}-${mongoId}`;
};

const buildMasterSymbolId = (symbolDoc = {}, options = {}) => {
  return (
    buildStableFrontMonthFutureSymbolId(symbolDoc, options) ||
    buildLegacyMasterSymbolId(symbolDoc)
  );
};

const looksLikeMasterSymbolId = (value = '') => {
  const normalized = normalizeSymbolIdValue(value);
  if (!normalized) return false;

  return (
    LEGACY_MASTER_SYMBOL_ID_REGEX.test(normalized) ||
    STABLE_FRONT_MONTH_MASTER_SYMBOL_ID_REGEX.test(normalized)
  );
};

export {
  buildLegacyMasterSymbolId,
  buildMasterSymbolId,
  buildStableFrontMonthFutureSymbolId,
  getStableFrontMonthFutureIdParts,
  looksLikeMasterSymbolId,
  sanitizeSymbolIdPart,
};

const MONTH_INDEX = new Map([
  ['JAN', 0],
  ['FEB', 1],
  ['MAR', 2],
  ['APR', 3],
  ['MAY', 4],
  ['JUN', 5],
  ['JUL', 6],
  ['AUG', 7],
  ['SEP', 8],
  ['OCT', 9],
  ['NOV', 10],
  ['DEC', 11],
]);
const INDIA_TIMEZONE_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHLY_EXPIRY_EXCHANGES = new Set(['NFO', 'BCD', 'CDS']);
const MONTHLY_EXPIRY_SEGMENTS = new Set(['FNO', 'CURRENCY']);

const MONTH_TOKEN_PATTERN = '(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)';
const SYMBOL_MONTH_REGEX = new RegExp(`(\\d{2})${MONTH_TOKEN_PATTERN}(?=FUT|OPT|CE|PE|\\b)`, 'i');
const TEXT_MONTH_REGEX = new RegExp(`\\b(?:\\d{1,2}\\s+)?${MONTH_TOKEN_PATTERN}\\b(?:\\s+(20\\d{2}|\\d{2}))?`, 'i');
const normalizeUpper = (value = '') => String(value || '').trim().toUpperCase();

const normalizeYear = (value, fallbackYear) => {
  const numeric = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(numeric)) return fallbackYear;
  if (numeric >= 2000) return numeric;
  if (numeric >= 0 && numeric <= 99) return 2000 + numeric;
  return fallbackYear;
};

const extractMonthYear = (value, fallbackYear) => {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return null;

  const symbolMatch = text.match(SYMBOL_MONTH_REGEX);
  if (symbolMatch) {
    return {
      month: MONTH_INDEX.get(symbolMatch[2].toUpperCase()),
      year: normalizeYear(symbolMatch[1], fallbackYear),
    };
  }

  const textMatch = text.match(TEXT_MONTH_REGEX);
  if (textMatch) {
    return {
      month: MONTH_INDEX.get(textMatch[1].toUpperCase()),
      year: normalizeYear(textMatch[2], fallbackYear),
    };
  }

  return null;
};

const getIndiaDateParts = (referenceDate = new Date()) => {
  const date = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (Number.isNaN(date.getTime())) return null;

  const shifted = new Date(date.getTime() + INDIA_TIMEZONE_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
};

const getLastWeekdayOfMonth = (year, month, weekday) => {
  let day = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  while (day > 0 && new Date(Date.UTC(year, month, day)).getUTCDay() !== weekday) {
    day -= 1;
  }
  return day;
};

const addMonths = ({ year, month }, count = 1) => {
  const shifted = new Date(Date.UTC(year, month + count, 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
  };
};

const usesMonthlyExpiryRollover = (doc = {}) => {
  const exchange = normalizeUpper(doc.exchange);
  const segment = normalizeUpper(doc.segment);
  const symbol = normalizeUpper(doc.symbol);
  const sourceSymbol = normalizeUpper(doc.sourceSymbol);

  return (
    MONTHLY_EXPIRY_EXCHANGES.has(exchange) ||
    MONTHLY_EXPIRY_SEGMENTS.has(segment) ||
    symbol.startsWith('NFO:') ||
    symbol.startsWith('BCD:') ||
    symbol.startsWith('CDS:') ||
    sourceSymbol.startsWith('NFO:') ||
    sourceSymbol.startsWith('BCD:') ||
    sourceSymbol.startsWith('CDS:')
  );
};

const getContractReferenceMonthYear = (doc = {}, referenceDate = new Date()) => {
  const indiaDate = getIndiaDateParts(referenceDate);
  if (!indiaDate) return null;

  if (!usesMonthlyExpiryRollover(doc)) {
    return { year: indiaDate.year, month: indiaDate.month };
  }

  const lastThursday = getLastWeekdayOfMonth(indiaDate.year, indiaDate.month, 4);
  if (indiaDate.day > lastThursday) {
    return addMonths(indiaDate, 1);
  }

  return { year: indiaDate.year, month: indiaDate.month };
};

const extractMonthYearFromDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
  };
};

const extractContractMonthYear = (doc = {}, referenceDate = new Date()) => {
  const fallbackYear = getIndiaDateParts(referenceDate)?.year || referenceDate.getUTCFullYear();
  const candidates = [doc.symbol, doc.sourceSymbol, doc.name];

  for (const value of candidates) {
    const parsed = extractMonthYear(value, fallbackYear);
    if (parsed && Number.isInteger(parsed.month) && Number.isInteger(parsed.year)) {
      return parsed;
    }
  }

  return null;
};

const hasExplicitContractMonth = (doc = {}, referenceDate = new Date()) =>
  Boolean(extractContractMonthYear(doc, referenceDate));

const isCurrentMonthExpiry = (expiry, referenceDate = new Date(), doc = {}) => {
  const parsed = extractMonthYearFromDate(expiry);
  if (!parsed) return false;

  const target = getContractReferenceMonthYear(doc, referenceDate);
  if (!target) return false;

  return parsed.year === target.year && parsed.month === target.month;
};

const isCurrentMonthContractDoc = (doc = {}, referenceDate = new Date()) => {
  const parsed = extractContractMonthYear(doc, referenceDate);
  if (!parsed) return true;

  const target = getContractReferenceMonthYear(doc, referenceDate);
  if (!target) return false;

  return parsed.year === target.year && parsed.month === target.month;
};

export {
  extractContractMonthYear,
  getContractReferenceMonthYear,
  hasExplicitContractMonth,
  isCurrentMonthExpiry,
  isCurrentMonthContractDoc,
};

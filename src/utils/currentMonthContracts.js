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

const MONTH_TOKEN_PATTERN = '(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)';
const SYMBOL_MONTH_REGEX = new RegExp(`(\\d{2})${MONTH_TOKEN_PATTERN}(?=FUT|OPT|CE|PE|\\b)`, 'i');
const TEXT_MONTH_REGEX = new RegExp(`\\b(?:\\d{1,2}\\s+)?${MONTH_TOKEN_PATTERN}\\b(?:\\s+(20\\d{2}|\\d{2}))?`, 'i');

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

const extractContractMonthYear = (doc = {}, referenceDate = new Date()) => {
  const fallbackYear = referenceDate.getUTCFullYear();
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

const isCurrentMonthContractDoc = (doc = {}, referenceDate = new Date()) => {
  const parsed = extractContractMonthYear(doc, referenceDate);
  if (!parsed) return true;

  return (
    parsed.year === referenceDate.getUTCFullYear() &&
    parsed.month === referenceDate.getUTCMonth()
  );
};

export {
  extractContractMonthYear,
  hasExplicitContractMonth,
  isCurrentMonthContractDoc,
};

const sanitizeSymbolIdPart = (value, fallback = 'NA') => {
  const sanitized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized || fallback;
};

const buildMasterSymbolId = (symbolDoc = {}) => {
  const mongoId = String(symbolDoc?._id || '').trim();
  if (!mongoId) return '';

  const segment = sanitizeSymbolIdPart(symbolDoc.segment, 'SEG');
  const symbol = sanitizeSymbolIdPart(symbolDoc.symbol, 'SYMBOL');

  return `${segment}-${symbol}-${mongoId}`;
};

export {
  buildMasterSymbolId,
  sanitizeSymbolIdPart,
};

const INDIA_TIMEZONE_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const toDate = (value) => {
  if (value instanceof Date) {
    const cloned = new Date(value.getTime());
    return Number.isNaN(cloned.getTime()) ? null : cloned;
  }

  if (value === undefined || value === null || value === '') return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIndiaShiftedDate = (value) => {
  const parsed = toDate(value);
  if (!parsed) return null;
  return new Date(parsed.getTime() + INDIA_TIMEZONE_OFFSET_MS);
};

const fromIndiaShiftedDate = (value) => {
  const parsed = toDate(value);
  if (!parsed) return null;
  return new Date(parsed.getTime() - INDIA_TIMEZONE_OFFSET_MS);
};

const getStartOfIndiaDay = (value) => {
  const shifted = toIndiaShiftedDate(value);
  if (!shifted) return null;

  shifted.setUTCHours(0, 0, 0, 0);
  return fromIndiaShiftedDate(shifted);
};

const getEndOfIndiaDay = (value) => {
  const shifted = toIndiaShiftedDate(value);
  if (!shifted) return null;

  shifted.setUTCHours(23, 59, 59, 999);
  return fromIndiaShiftedDate(shifted);
};

const addIndiaDays = (value, days = 0) => {
  const shifted = toIndiaShiftedDate(value);
  if (!shifted) return null;

  shifted.setUTCDate(shifted.getUTCDate() + Number(days || 0));
  return fromIndiaShiftedDate(shifted);
};

const getStartOfIndiaWeek = (value) => {
  const shifted = toIndiaShiftedDate(value);
  if (!shifted) return null;

  const day = shifted.getUTCDay();
  const diff = shifted.getUTCDate() - day + (day === 0 ? -6 : 1);

  shifted.setUTCDate(diff);
  shifted.setUTCHours(0, 0, 0, 0);
  return fromIndiaShiftedDate(shifted);
};

const getStartOfIndiaMonth = (value) => {
  const shifted = toIndiaShiftedDate(value);
  if (!shifted) return null;

  shifted.setUTCDate(1);
  shifted.setUTCHours(0, 0, 0, 0);
  return fromIndiaShiftedDate(shifted);
};

export {
  INDIA_TIMEZONE_OFFSET_MS,
  addIndiaDays,
  getEndOfIndiaDay,
  getStartOfIndiaDay,
  getStartOfIndiaMonth,
  getStartOfIndiaWeek,
};

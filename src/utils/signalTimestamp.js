const INDIA_TIMEZONE_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_WITHOUT_TZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/;

const buildIndiaDate = ({
  year,
  month,
  day,
  hours = 0,
  minutes = 0,
  seconds = 0,
  milliseconds = 0,
}) =>
  new Date(
    Date.UTC(year, month - 1, day, hours, minutes, seconds, milliseconds) -
      INDIA_TIMEZONE_OFFSET_MS
  );

const hasExplicitTimezone = (value = '') =>
  /(?:[zZ]|[+-]\d{2}:\d{2}|[+-]\d{4})$/.test(String(value).trim());

const parseMilliseconds = (value = '') => {
  if (!value) return 0;
  return Number(String(value).slice(1).padEnd(3, '0').slice(0, 3));
};

export const parseSignalTimestamp = (value) => {
  if (value === undefined || value === null || value === '') return null;

  if (value instanceof Date) {
    const cloned = new Date(value.getTime());
    return Number.isNaN(cloned.getTime()) ? null : cloned;
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value !== 'string') return null;

  const raw = value.trim();
  if (!raw) return null;

  if (!hasExplicitTimezone(raw)) {
    const dateTimeMatch = raw.match(DATE_TIME_WITHOUT_TZ_PATTERN);
    if (dateTimeMatch) {
      const [
        ,
        year,
        month,
        day,
        hours,
        minutes,
        seconds = '0',
        milliseconds = '',
      ] = dateTimeMatch;

      return buildIndiaDate({
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hours: Number(hours),
        minutes: Number(minutes),
        seconds: Number(seconds),
        milliseconds: parseMilliseconds(milliseconds),
      });
    }

    const dateOnlyMatch = raw.match(DATE_ONLY_PATTERN);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      return buildIndiaDate({
        year: Number(year),
        month: Number(month),
        day: Number(day),
      });
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const normalizeSignalTimestampInput = (value) => {
  if (value === undefined || value === null || value === '') return value;
  return parseSignalTimestamp(value) || value;
};

export { INDIA_TIMEZONE_OFFSET_MS };

const INDIA_TIMEZONE_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DEFAULT_SIGNAL_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_COMEX_SIGNAL_TIMEZONE = 'America/New_York';
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_WITHOUT_TZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/;
const GLOBAL_COMMODITY_SEGMENTS = new Set(['COMEX', 'NYMEX']);
const GLOBAL_COMMODITY_SYMBOL_PATTERN =
  /(?:^|:)(XAUUSD|XAGUSD|WTI|USOIL|UKOIL|BRENTUSD|CL1!|BRN1!|NG1!|GC1!|GCI|XPTUSD|COPPERUSD|NATGASUSD)$/i;
const timezoneOffsetFormatterCache = new Map();

const getConfiguredDefaultSignalTimezone = () =>
  String(process.env.WEBHOOK_SIGNAL_TIMEZONE || DEFAULT_SIGNAL_TIMEZONE).trim() || DEFAULT_SIGNAL_TIMEZONE;

const getConfiguredComexSignalTimezone = () =>
  String(process.env.WEBHOOK_COMEX_TIMEZONE || DEFAULT_COMEX_SIGNAL_TIMEZONE).trim() ||
  DEFAULT_COMEX_SIGNAL_TIMEZONE;

const hasExplicitTimezone = (value = '') =>
  /(?:[zZ]|[+-]\d{2}:\d{2}|[+-]\d{4})$/.test(String(value).trim());

const parseMilliseconds = (value = '') => {
  if (!value) return 0;
  return Number(String(value).slice(1).padEnd(3, '0').slice(0, 3));
};

const normalizeUpper = (value) => String(value ?? '').trim().toUpperCase();

const isGlobalCommodityContext = ({ symbol = '', segment = '' } = {}) => {
  const normalizedSegment = normalizeUpper(segment);
  if (GLOBAL_COMMODITY_SEGMENTS.has(normalizedSegment)) return true;

  const normalizedSymbol = normalizeUpper(symbol);
  if (!normalizedSymbol) return false;

  return GLOBAL_COMMODITY_SYMBOL_PATTERN.test(normalizedSymbol);
};

const getTimezoneOffsetFormatter = (timezone) => {
  if (!timezoneOffsetFormatterCache.has(timezone)) {
    timezoneOffsetFormatterCache.set(
      timezone,
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'longOffset',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    );
  }

  return timezoneOffsetFormatterCache.get(timezone);
};

const getTimezoneOffsetMinutes = (timezone, date) => {
  try {
    const formatter = getTimezoneOffsetFormatter(timezone);
    const timeZoneName =
      formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || '';
    const normalized = timeZoneName.replace(/^UTC/i, 'GMT');

    if (normalized === 'GMT') return 0;

    const match = normalized.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/i);
    if (!match) return null;

    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number.parseInt(match[2], 10);
    const minutes = Number.parseInt(match[3] || '0', 10);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return sign * (hours * 60 + minutes);
  } catch {
    return null;
  }
};

const buildDateForTimezone = (
  {
    year,
    month,
    day,
    hours = 0,
    minutes = 0,
    seconds = 0,
    milliseconds = 0,
  },
  timezone
) => {
  const baseUtcMs = Date.UTC(year, month - 1, day, hours, minutes, seconds, milliseconds);
  const initialOffsetMinutes = getTimezoneOffsetMinutes(timezone, new Date(baseUtcMs));
  if (initialOffsetMinutes === null) return null;

  let resolved = new Date(baseUtcMs - initialOffsetMinutes * 60 * 1000);
  const correctedOffsetMinutes = getTimezoneOffsetMinutes(timezone, resolved);

  if (
    correctedOffsetMinutes !== null &&
    Number.isFinite(correctedOffsetMinutes) &&
    correctedOffsetMinutes !== initialOffsetMinutes
  ) {
    resolved = new Date(baseUtcMs - correctedOffsetMinutes * 60 * 1000);
  }

  return Number.isNaN(resolved.getTime()) ? null : resolved;
};

const resolveTimestampTimezoneCandidates = (options = {}) => {
  const configuredDefaultTimezone = getConfiguredDefaultSignalTimezone();
  const configuredComexTimezone = getConfiguredComexSignalTimezone();
  const candidates = [];
  const addCandidate = (timezone) => {
    const normalized = String(timezone || '').trim();
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  if (Array.isArray(options.candidateTimezones)) {
    options.candidateTimezones.forEach(addCandidate);
  } else if (options.timezone) {
    addCandidate(options.timezone);
  }

  if (isGlobalCommodityContext(options)) {
    addCandidate(configuredComexTimezone);
  }

  addCandidate(configuredDefaultTimezone);

  if (isGlobalCommodityContext(options)) {
    addCandidate('UTC');
  }

  return candidates;
};

const resolveReferenceTimeMs = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? Date.now() : value.getTime();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return Date.now();
};

const pickBestTimestampCandidate = (candidates = [], options = {}) => {
  const validCandidates = candidates.filter((candidate) => candidate instanceof Date && !Number.isNaN(candidate.getTime()));
  if (validCandidates.length <= 1) {
    return validCandidates[0] || null;
  }

  const referenceTimeMs = resolveReferenceTimeMs(options.referenceTime);
  const futureToleranceMs =
    typeof options.futureToleranceMs === 'number' && Number.isFinite(options.futureToleranceMs)
      ? options.futureToleranceMs
      : 10 * 60 * 1000;

  let bestCandidate = null;
  let bestScore = Number.POSITIVE_INFINITY;

  validCandidates.forEach((candidate) => {
    const deltaMs = candidate.getTime() - referenceTimeMs;
    let score = Math.abs(deltaMs);

    if (deltaMs > futureToleranceMs) {
      score += 365 * 24 * 60 * 60 * 1000;
    } else if (deltaMs > 0) {
      score += 30 * 60 * 1000;
    }

    if (score < bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  });

  return bestCandidate;
};

export const parseSignalTimestamp = (value, options = {}) => {
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

      const timestampParts = {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hours: Number(hours),
        minutes: Number(minutes),
        seconds: Number(seconds),
        milliseconds: parseMilliseconds(milliseconds),
      };
      const candidates = resolveTimestampTimezoneCandidates(options).map((timezone) =>
        buildDateForTimezone(timestampParts, timezone)
      );
      return pickBestTimestampCandidate(candidates, options);
    }

    const dateOnlyMatch = raw.match(DATE_ONLY_PATTERN);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      const timestampParts = {
        year: Number(year),
        month: Number(month),
        day: Number(day),
      };
      const candidates = resolveTimestampTimezoneCandidates(options).map((timezone) =>
        buildDateForTimezone(timestampParts, timezone)
      );
      return pickBestTimestampCandidate(candidates, options);
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const normalizeSignalTimestampInput = (value, options = {}) => {
  if (value === undefined || value === null || value === '') return value;
  return parseSignalTimestamp(value, options) || value;
};

export { INDIA_TIMEZONE_OFFSET_MS };

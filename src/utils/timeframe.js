const normalizeMinuteAmount = (amount, raw) => {
  if (!Number.isFinite(amount) || amount <= 0) return raw;
  if (amount < 60) return `${amount}m`;
  if (amount < 1440 && amount % 60 === 0) return `${amount / 60}h`;
  if (amount === 1440) return '1D';
  if (amount === 10080) return '1W';
  if (amount === 43200) return '1M';
  return `${amount}m`;
};

const DEFAULT_SIGNAL_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_COMEX_SIGNAL_TIMEZONE = 'America/New_York';
const GLOBAL_COMMODITY_SEGMENTS = new Set(['COMEX', 'NYMEX']);
const GLOBAL_COMMODITY_SYMBOL_PATTERN =
  /(?:^|:)(XAUUSD|XAGUSD|WTI|USOIL|UKOIL|BRENTUSD|CL1!|BRN1!|NG1!|GC1!|GCI|XPTUSD|COPPERUSD|NATGASUSD)$/i;
const timezoneOffsetFormatterCache = new Map();

const normalizeUpper = (value) => String(value ?? '').trim().toUpperCase();

const isGlobalCommodityContext = ({ symbol = '', segment = '' } = {}) => {
  const normalizedSegment = normalizeUpper(segment);
  if (GLOBAL_COMMODITY_SEGMENTS.has(normalizedSegment)) return true;

  const normalizedSymbol = normalizeUpper(symbol);
  if (!normalizedSymbol) return false;

  return GLOBAL_COMMODITY_SYMBOL_PATTERN.test(normalizedSymbol);
};

const resolveTimeframeTimezone = (options = {}) => {
  const explicitTimezone = String(options?.timezone || '').trim();
  if (explicitTimezone) return explicitTimezone;

  if (isGlobalCommodityContext(options)) {
    return String(process.env.WEBHOOK_COMEX_TIMEZONE || DEFAULT_COMEX_SIGNAL_TIMEZONE).trim() ||
      DEFAULT_COMEX_SIGNAL_TIMEZONE;
  }

  return String(process.env.WEBHOOK_SIGNAL_TIMEZONE || DEFAULT_SIGNAL_TIMEZONE).trim() || DEFAULT_SIGNAL_TIMEZONE;
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

const normalizeSignalTimeframe = (value) => {
  if (value === null || value === undefined) return '';

  const raw = String(value).trim();
  if (!raw) return '';

  const normalized = raw.toUpperCase();
  const compact = normalized.replace(/[\s._-]+/g, '');

  if (normalized === 'S' || compact === 'SCALP') return 'Scalp';
  if (/^\d+S$/.test(compact)) return `${Number.parseInt(compact, 10)}s`;
  if (/^\d+M$/.test(compact)) return `${Number.parseInt(compact, 10)}m`;
  if (/^\d+H$/.test(compact)) return `${Number.parseInt(compact, 10)}h`;

  const minuteLabelMatch = compact.match(/^(\d+)(MIN|MINS|MINUTE|MINUTES)$/);
  if (minuteLabelMatch) {
    return normalizeMinuteAmount(Number(minuteLabelMatch[1]), raw);
  }

  const hourLabelMatch = compact.match(/^(\d+)(HR|HRS|HOUR|HOURS)$/);
  if (hourLabelMatch) {
    return `${Number.parseInt(hourLabelMatch[1], 10)}h`;
  }

  if (['D', '1D', 'DAY', '1DAY'].includes(compact)) return '1D';
  if (['W', '1W', 'WEEK', '1WEEK'].includes(compact)) return '1W';
  if (['M', '1M', 'MO', 'MON', 'MN', 'MONTH', '1MO', '1MON', '1MONTH'].includes(compact)) {
    return '1M';
  }

  if (/^\d+$/.test(compact)) {
    return normalizeMinuteAmount(Number(compact), raw);
  }

  return raw;
};

const WEBHOOK_TIMEFRAME_KEYS = [
  'timeframe',
  'timeFrame',
  'time_frame',
  'interval',
  'resolution',
  'chart_interval',
  'chartInterval',
];

const getWebhookTimeframeValue = (payload = {}) => {
  for (const key of WEBHOOK_TIMEFRAME_KEYS) {
    const value = payload?.[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }

  return '';
};

const getTimeframeDurationMs = (value) => {
  const normalized = normalizeSignalTimeframe(value);
  if (!normalized) return 0;

  if (normalized === 'Scalp') return 5 * 60 * 1000;

  const secondsMatch = normalized.match(/^(\d+)s$/i);
  if (secondsMatch) {
    return Number(secondsMatch[1]) * 1000;
  }

  const minutesMatch = normalized.match(/^(\d+)m$/i);
  if (minutesMatch) {
    return Number(minutesMatch[1]) * 60 * 1000;
  }

  const hoursMatch = normalized.match(/^(\d+)h$/i);
  if (hoursMatch) {
    return Number(hoursMatch[1]) * 60 * 60 * 1000;
  }

  if (normalized === '1D') return 24 * 60 * 60 * 1000;
  if (normalized === '1W') return 7 * 24 * 60 * 60 * 1000;
  if (normalized === '1M') return 30 * 24 * 60 * 60 * 1000;

  return 0;
};

const floorTimestampToTimeframe = (value, timeframe, options = {}) => {
  if (value === undefined || value === null || value === '') return null;

  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const timeframeMs = getTimeframeDurationMs(timeframe);
  if (!Number.isFinite(timeframeMs) || timeframeMs <= 0 || timeframeMs > 24 * 60 * 60 * 1000) {
    return parsed;
  }

  const timezone = resolveTimeframeTimezone(options);
  const offsetMinutes = getTimezoneOffsetMinutes(timezone, parsed);
  if (!Number.isFinite(offsetMinutes)) {
    return new Date(Math.floor(parsed.getTime() / timeframeMs) * timeframeMs);
  }

  const offsetMs = offsetMinutes * 60 * 1000;
  return new Date(Math.floor((parsed.getTime() + offsetMs) / timeframeMs) * timeframeMs - offsetMs);
};

const addAlias = (target, value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return;

  target.add(raw);
  target.add(raw.toLowerCase());
  target.add(raw.toUpperCase());
};

const buildTimeframeAliases = (value) => {
  const raw = String(value ?? '').trim();
  const canonical = normalizeSignalTimeframe(raw);
  const aliases = new Set();

  addAlias(aliases, raw);
  addAlias(aliases, canonical);

  if (!canonical) {
    return Array.from(aliases);
  }

  if (canonical === 'Scalp') {
    addAlias(aliases, 'S');
    addAlias(aliases, 'Scalp');
    return Array.from(aliases);
  }

  const secondsMatch = canonical.match(/^(\d+)s$/i);
  if (secondsMatch) {
    const seconds = Number(secondsMatch[1]);
    addAlias(aliases, `${seconds}S`);
    addAlias(aliases, `${seconds}s`);
    return Array.from(aliases);
  }

  const minutesMatch = canonical.match(/^(\d+)m$/i);
  if (minutesMatch) {
    const minutes = Number(minutesMatch[1]);
    addAlias(aliases, String(minutes));
    addAlias(aliases, `${minutes}M`);
    addAlias(aliases, `${minutes}m`);
    addAlias(aliases, `${minutes}MIN`);
    addAlias(aliases, `${minutes}MINS`);
    addAlias(aliases, `${minutes}MINUTE`);
    addAlias(aliases, `${minutes}MINUTES`);

    if (minutes < 10) {
      const padded = String(minutes).padStart(2, '0');
      addAlias(aliases, padded);
      addAlias(aliases, `${padded}M`);
      addAlias(aliases, `${padded}m`);
    }

    return Array.from(aliases);
  }

  const hoursMatch = canonical.match(/^(\d+)h$/i);
  if (hoursMatch) {
    const hours = Number(hoursMatch[1]);
    const minutes = hours * 60;
    addAlias(aliases, `${hours}H`);
    addAlias(aliases, `${hours}h`);
    addAlias(aliases, `${hours}HR`);
    addAlias(aliases, `${hours}hr`);
    addAlias(aliases, `${hours}HRS`);
    addAlias(aliases, `${hours}hrs`);
    addAlias(aliases, `${hours}HOUR`);
    addAlias(aliases, `${hours}hour`);
    addAlias(aliases, `${hours}HOURS`);
    addAlias(aliases, `${hours}hours`);
    addAlias(aliases, String(minutes));
    addAlias(aliases, `${minutes}M`);
    addAlias(aliases, `${minutes}m`);
    addAlias(aliases, `${minutes}MIN`);
    addAlias(aliases, `${minutes}MINUTES`);
    return Array.from(aliases);
  }

  if (canonical === '1D') {
    addAlias(aliases, 'D');
    addAlias(aliases, 'DAY');
    addAlias(aliases, '1440');
    addAlias(aliases, '1440M');
    return Array.from(aliases);
  }

  if (canonical === '1W') {
    addAlias(aliases, 'W');
    addAlias(aliases, 'WEEK');
    addAlias(aliases, '10080');
    addAlias(aliases, '10080M');
    return Array.from(aliases);
  }

  if (canonical === '1M') {
    ['M', 'MO', 'MON', 'MN', 'MONTH', '1M', '1MO', '1MON', '1MONTH', '43200', '43200M'].forEach(
      (alias) => addAlias(aliases, alias)
    );
  }

  return Array.from(aliases);
};

const buildTimeframeQuery = (fieldName, value) => {
  const aliases = buildTimeframeAliases(value);
  if (aliases.length === 0) return null;

  return {
    [fieldName]: { $in: aliases },
  };
};

export {
  buildTimeframeAliases,
  buildTimeframeQuery,
  floorTimestampToTimeframe,
  getWebhookTimeframeValue,
  getTimeframeDurationMs,
  normalizeSignalTimeframe,
};

import { normalizeSignalTimeframe } from './timeframe.js';

const numberFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
});

export const toFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

export const formatNotificationNumber = (value) => {
  const parsed = toFiniteNumber(value);
  if (typeof parsed !== 'number') return '-';
  return numberFormatter.format(parsed);
};

export const formatPointsLabel = (value) => {
  const parsed = toFiniteNumber(value);
  if (typeof parsed !== 'number') return '-';
  if (parsed === 0) return '0';
  const absolute = numberFormatter.format(Math.abs(parsed));
  return parsed > 0 ? `+${absolute}` : `-${absolute}`;
};

const humanizeTimeframe = (value) => {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return '';
  if (raw.toLowerCase() === 'scalp') return 'Scalp';

  const minutesMatch = raw.match(/^(\d+)m$/i);
  if (minutesMatch) {
    const minutes = Number(minutesMatch[1]);
    if (Number.isFinite(minutes) && minutes > 0) {
      return `${minutes}-minute`;
    }
  }

  const hoursMatch = raw.match(/^(\d+)h$/i);
  if (hoursMatch) {
    const hours = Number(hoursMatch[1]);
    if (Number.isFinite(hours) && hours > 0) {
      return `${hours}-hour`;
    }
  }

  if (raw === '1D') return 'Daily';
  if (raw === '1W') return 'Weekly';
  if (raw === '1M') return 'Monthly';

  return raw;
};

const formatSignalTimestamp = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
};

export const getSignalTemplateKey = (signal) =>
  String(signal?.subType || 'SIGNAL_NEW').trim().toUpperCase();

export const buildSignalTemplateData = (signal = {}) => {
  const normalizedTimeframe =
    normalizeSignalTimeframe(signal.timeframe) || String(signal.timeframe || '').trim();
  const timeframeLabel = normalizedTimeframe ? humanizeTimeframe(normalizedTimeframe) : '';
  const signalTime = formatSignalTimestamp(signal.signalTime || signal.createdAt);
  const exitTime = formatSignalTimestamp(signal.exitTime || signal.updatedAt);
  const eventTime = formatSignalTimestamp(
    signal.exitTime || signal.signalTime || signal.updatedAt || signal.createdAt
  );
  const timeframeDisplay = normalizedTimeframe
    ? timeframeLabel && timeframeLabel !== normalizedTimeframe
      ? `${normalizedTimeframe} (${timeframeLabel})`
      : normalizedTimeframe
    : '-';
  const entryPrice = toFiniteNumber(signal.entryPrice);
  const stopLoss = toFiniteNumber(signal.stopLoss);
  const target1 = toFiniteNumber(signal.targets?.target1);
  const target2 = toFiniteNumber(signal.targets?.target2);
  const target3 = toFiniteNumber(signal.targets?.target3);
  const exitPrice = toFiniteNumber(signal.exitPrice ?? signal.currentPrice);
  const storedPoints = toFiniteNumber(signal.totalPoints);
  const signalType = String(signal.type || 'BUY').trim().toUpperCase();
  const derivedPoints =
    typeof entryPrice === 'number' && typeof exitPrice === 'number'
      ? signalType === 'SELL'
        ? entryPrice - exitPrice
        : exitPrice - entryPrice
      : undefined;
  const totalPoints =
    typeof storedPoints === 'number' && (Math.abs(storedPoints) > 0 || typeof derivedPoints !== 'number')
      ? storedPoints
      : derivedPoints;

  return {
    symbol: signal.symbol || '-',
    timeframe: normalizedTimeframe || '-',
    timeframeLabel: timeframeDisplay,
    signalTime: signalTime || '-',
    entryTime: signalTime || '-',
    exitTime: exitTime || '-',
    eventTime: eventTime || '-',
    type: signal.type || '-',
    entryPrice: formatNotificationNumber(entryPrice),
    stopLoss: formatNotificationNumber(stopLoss),
    target1: formatNotificationNumber(target1),
    target2: formatNotificationNumber(target2),
    target3: formatNotificationNumber(target3),
    notes: signal.notes || '',
    updateMessage: signal.updateMessage || signal.notes || signal.message || '',
    targetLevel: signal.targetLevel || signal.messageCode || 'TP1',
    messageCode: signal.messageCode || '',
    currentPrice: formatNotificationNumber(signal.currentPrice ?? exitPrice ?? entryPrice),
    exitPrice: formatNotificationNumber(exitPrice),
    totalPoints: typeof totalPoints === 'number' ? String(Math.round(totalPoints * 100) / 100) : '-',
    pointsLabel: formatPointsLabel(totalPoints),
    outcomeLabel: signal.status || signal.exitReason || '',
  };
};

const ensureSignalSummaryPlaceholders = (templateKey, template) => {
  if (!template || typeof template !== 'object') {
    return { title: '', body: '' };
  }

  const normalizedTemplate = {
    title: template.title || '',
    body: template.body || '',
  };

  const next = { ...normalizedTemplate };
  const signalTemplateKeys = [
    'SIGNAL_NEW',
    'SIGNAL_UPDATE',
    'SIGNAL_INFO',
    'SIGNAL_TARGET',
    'SIGNAL_STOPLOSS',
    'SIGNAL_PARTIAL_PROFIT',
  ];

  if (signalTemplateKeys.includes(templateKey) && !next.body.includes('{{symbol}}')) {
    next.body = `Symbol: {{symbol}}${next.body ? `\n${next.body}` : ''}`;
  }

  if (signalTemplateKeys.includes(templateKey) && !next.body.includes('{{timeframeLabel}}')) {
    next.body = `${next.body}\nTimeframe: {{timeframeLabel}}`.trim();
  }

  if (signalTemplateKeys.includes(templateKey) && !next.body.includes('{{signalTime}}') && !next.body.includes('{{entryTime}}')) {
    next.body = `${next.body}\nEntry Time (IST): {{signalTime}}`.trim();
  }

  if (!['SIGNAL_TARGET', 'SIGNAL_STOPLOSS', 'SIGNAL_PARTIAL_PROFIT'].includes(templateKey)) {
    return next;
  }

  if (!next.body.includes('{{exitTime}}')) {
    next.body = `${next.body}\nExit Time (IST): {{exitTime}}`;
  }
  if (!next.body.includes('{{exitPrice}}')) {
    next.body = `${next.body}\nExit: {{exitPrice}}`;
  }
  if (!next.body.includes('{{pointsLabel}}')) {
    next.body = `${next.body}\nPoints: {{pointsLabel}}`;
  }

  return next;
};

export const renderNotificationTemplate = (templates, templateKey, data) => {
  const fallbackTemplate = templates?.ANNOUNCEMENT || { title: '{{title}}', body: '{{message}}' };
  const rawTemplate = templates?.[templateKey] || fallbackTemplate;
  const template = ensureSignalSummaryPlaceholders(templateKey, rawTemplate);

  let title = template.title;
  let body = template.body;

  Object.keys(data || {}).forEach((key) => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    const value = data[key] !== undefined && data[key] !== null ? String(data[key]) : '';
    title = title.replace(regex, value);
    body = body.replace(regex, value);
  });

  return { title, body };
};

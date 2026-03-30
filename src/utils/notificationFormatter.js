import { getTimeframeDurationMs, normalizeSignalTimeframe } from './timeframe.js';
import { parseSignalTimestamp } from './signalTimestamp.js';

const numberFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
});

export const CLOSED_SIGNAL_STATUSES = ['Closed', 'Target Hit', 'Partial Profit Book', 'Stoploss Hit'];
export const isClosedSignalStatus = (status) =>
  CLOSED_SIGNAL_STATUSES.includes(String(status || '').trim());

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

const INLINE_TIMESTAMP_PATTERN =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})\b/g;

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

const parseTimestamp = (value) => {
  return parseSignalTimestamp(value);
};

export const resolveDisplayTimestamp = ({
  primary,
  fallback,
  timeframe,
  floor,
  preferPrimaryWhenAvailable = false,
}) => {
  const primaryDate = parseTimestamp(primary);
  const fallbackDate = parseTimestamp(fallback);
  const floorDate = parseTimestamp(floor);
  const timeframeMs = getTimeframeDurationMs(timeframe);

  const resolveFallback = () => {
    if (fallbackDate && floorDate && fallbackDate.getTime() < floorDate.getTime()) {
      return floorDate;
    }

    return fallbackDate || floorDate || null;
  };

  if (!primaryDate) return resolveFallback();
  if (!fallbackDate) {
    if (floorDate && primaryDate.getTime() < floorDate.getTime()) {
      return floorDate;
    }
    return primaryDate;
  }

  const maxAllowedSkewMs = Math.min(
    Math.max(timeframeMs * 3, 30 * 60 * 1000),
    6 * 60 * 60 * 1000
  );
  const candleCloseGraceMs = Math.min(
    Math.max(Math.round(timeframeMs * 0.1), 90 * 1000),
    3 * 60 * 1000
  );
  const primaryToFallbackLagMs = fallbackDate.getTime() - primaryDate.getTime();

  if (preferPrimaryWhenAvailable) {
    if (floorDate && primaryDate.getTime() < floorDate.getTime()) {
      return resolveFallback() || primaryDate;
    }
    if (primaryDate.getTime() - fallbackDate.getTime() > maxAllowedSkewMs) {
      return resolveFallback() || primaryDate;
    }
    return primaryDate;
  }

  if (floorDate && primaryDate.getTime() < floorDate.getTime()) {
    return resolveFallback() || primaryDate;
  }

  // Some providers emit candle-start timestamps (for example 7:00 pm on a 5m
  // signal) while the actual alert is generated near candle close (7:05 pm).
  // When the persisted record time lands almost exactly one timeframe after the
  // webhook time, show the actual alert time users saw in Telegram/WhatsApp.
  if (
    timeframeMs > 0 &&
    primaryToFallbackLagMs > 0 &&
    Math.abs(primaryToFallbackLagMs - timeframeMs) <= candleCloseGraceMs
  ) {
    return fallbackDate;
  }

  // Prefer the original webhook event time when it is plausible. Delayed webhook
  // delivery is common in production, and falling back to createdAt/updatedAt
  // makes users think the signal happened much later than it actually did.
  // We only discard the primary timestamp when it appears unrealistically ahead
  // of the persisted record time (clock skew / malformed future webhook time).
  if (primaryDate.getTime() - fallbackDate.getTime() > maxAllowedSkewMs) {
    return resolveFallback() || primaryDate;
  }

  return primaryDate;
};

const formatSignalTimestamp = (value) => {
  if (!value) return '';
  const date = parseTimestamp(value);
  if (!date) return String(value);
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
};

const formatInlineTimestamps = (value) =>
  String(value || '').replace(INLINE_TIMESTAMP_PATTERN, (match) => formatSignalTimestamp(match) || match);

const stripRedundantUpdateTime = (value, templateKey) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!['SIGNAL_INFO', 'SIGNAL_PARTIAL_PROFIT', 'SIGNAL_UPDATE'].includes(templateKey)) {
    return raw;
  }

  return raw.replace(
    /\s+on\s+.+?(\.\s*Trade remains active\.)$/i,
    '$1'
  );
};

export const getSignalTemplateKey = (signal) =>
  String(signal?.subType || 'SIGNAL_NEW').trim().toUpperCase();

const resolveNotificationEntryTimestamp = ({ templateKey, signalTime, createdAt, timeframe }) => {
  const createdDate = parseTimestamp(createdAt);
  const signalDate = parseTimestamp(signalTime);
  const isClosedTemplate = ['SIGNAL_TARGET', 'SIGNAL_STOPLOSS', 'SIGNAL_PARTIAL_PROFIT'].includes(templateKey);

  if (isClosedTemplate && signalDate) {
    return signalDate;
  }

  if (
    templateKey === 'SIGNAL_NEW' &&
    createdDate &&
    (!signalDate || createdDate.getTime() >= signalDate.getTime())
  ) {
    return createdDate;
  }

  return resolveDisplayTimestamp({
    primary: signalTime,
    fallback: createdAt,
    timeframe,
  });
};

export const buildSignalTemplateData = (signal = {}) => {
  const templateKey = getSignalTemplateKey(signal);
  const normalizedTimeframe =
    normalizeSignalTimeframe(signal.timeframe) || String(signal.timeframe || '').trim();
  const timeframeLabel = normalizedTimeframe ? humanizeTimeframe(normalizedTimeframe) : '';
  const normalizedTargetLevel = String(signal.targetLevel || signal.messageCode || 'TP1')
    .trim()
    .toUpperCase();
  const isClosedSignal = isClosedSignalStatus(signal.status);
  const resolvedSignalTime = resolveNotificationEntryTimestamp({
    templateKey,
    signalTime: signal.signalTime,
    createdAt: signal.createdAt,
    timeframe: normalizedTimeframe,
  });
  const resolvedExitTime = isClosedSignal
    ? resolveDisplayTimestamp({
        primary: signal.exitTime,
        fallback: signal.updatedAt || signal.createdAt,
        timeframe: normalizedTimeframe,
        floor: resolvedSignalTime,
      })
    : null;
  const signalTime = formatSignalTimestamp(resolvedSignalTime);
  const exitTime = formatSignalTimestamp(resolvedExitTime);
  const eventTimestampSource =
    templateKey === 'SIGNAL_INFO' || templateKey === 'SIGNAL_UPDATE' || templateKey === 'SIGNAL_PARTIAL_PROFIT'
      ? signal.updatedAt || signal.lastInfoTime || signal.infoTime || signal.createdAt || resolvedSignalTime
      : resolvedExitTime || resolvedSignalTime || signal.updatedAt || signal.createdAt;
  const eventTime = formatSignalTimestamp(eventTimestampSource);
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
  const targetPrice =
    normalizedTargetLevel.includes('3')
      ? target3
      : normalizedTargetLevel.includes('2')
        ? target2
        : normalizedTargetLevel.includes('1')
          ? target1
          : undefined;
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
    segment: signal.segment || '-',
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
    updateMessage: stripRedundantUpdateTime(
      formatInlineTimestamps(signal.updateMessage || signal.notes || signal.message || ''),
      templateKey
    ),
    targetLevel: normalizedTargetLevel || 'TP1',
    targetPrice: formatNotificationNumber(targetPrice),
    messageCode: signal.messageCode || '',
    currentPrice: formatNotificationNumber(signal.currentPrice ?? exitPrice ?? entryPrice),
    exitPrice: formatNotificationNumber(exitPrice),
    totalPoints: typeof totalPoints === 'number' ? String(Math.round(totalPoints * 100) / 100) : '-',
    pointsLabel: formatPointsLabel(totalPoints),
    outcomeLabel: signal.status || signal.exitReason || '',
  };
};

const MESSAGE_DIVIDER = '━━━━━━━━━━━━━━━━━━';

const compactMessage = (lines = []) =>
  lines
    .filter((line) => line !== null && line !== undefined)
    .map((line) => String(line).replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const hasDisplayValue = (value) => {
  const normalized = String(value ?? '').trim();
  return normalized && normalized !== '-';
};

const buildSignalHeader = (badge, data) => [
  `${badge} MSPK TRADE SOLUTIONS`,
  '',
  `📊 SYMBOL     : ${data.symbol}`,
  `⏱ TIME FRAME : ${data.timeframeLabel}`,
  MESSAGE_DIVIDER,
];

const buildTargetLines = (data) => [
  '🎯 Targets',
  `TP1            : ${data.target1}`,
  `TP2            : ${data.target2}`,
  `TP3            : ${data.target3}`,
];

export const buildSignalChannelMessage = (signal = {}) => {
  const data = buildSignalTemplateData(signal);
  const templateKey = getSignalTemplateKey(signal);
  const signalType = String(data.type || 'BUY').trim().toUpperCase();
  const targetLevel = String(data.targetLevel || 'TP1').trim().toUpperCase();
  const statusLabel = String(data.outcomeLabel || signal.status || '').trim();
  const updateMessage = String(data.updateMessage || '').trim();
  const isSell = signalType === 'SELL';
  const directionBadge = isSell ? '🔴' : '🟢';

  if (templateKey === 'SIGNAL_NEW') {
    return compactMessage([
      ...buildSignalHeader(directionBadge, data),
      isSell ? '📉 SELL SIGNAL' : '📈 BUY SIGNAL',
      MESSAGE_DIVIDER,
      `💹 Entry Price : ${data.entryPrice}`,
      `🛑 Stop Loss   : ${data.stopLoss}`,
      '',
      ...buildTargetLines(data),
      '',
      `🕒 Entry Time  : ${data.entryTime}`,
      `📌 Status      : ${statusLabel || 'Active'}`,
      MESSAGE_DIVIDER,
    ]);
  }

  if (templateKey === 'SIGNAL_TARGET') {
    const heading = targetLevel === 'TP3' ? '✅ FINAL TARGET HIT' : `✅ ${targetLevel} HIT`;
    return compactMessage([
      ...buildSignalHeader(targetLevel === 'TP3' ? '🏆' : '🎯', data),
      heading,
      MESSAGE_DIVIDER,
      `💹 Entry Price : ${data.entryPrice}`,
      `🚪 Exit Price  : ${data.exitPrice}`,
      `📊 Net Points  : ${data.pointsLabel}`,
      '',
      `🕒 Exit Time   : ${data.exitTime}`,
      `📌 Status      : ${statusLabel || 'Closed'}`,
      MESSAGE_DIVIDER,
    ]);
  }

  if (templateKey === 'SIGNAL_PARTIAL_PROFIT') {
    return compactMessage([
      ...buildSignalHeader('🎯', data),
      `✅ ${targetLevel} HIT`,
      MESSAGE_DIVIDER,
      `💹 Entry Price : ${data.entryPrice}`,
      `🎯 Target Price: ${hasDisplayValue(data.targetPrice) ? data.targetPrice : data.exitPrice}`,
      `📈 Current     : ${data.currentPrice}`,
      `📊 Net Points  : ${data.pointsLabel}`,
      hasDisplayValue(updateMessage) ? '' : null,
      hasDisplayValue(updateMessage) ? `📍 Update      : ${updateMessage}` : null,
      '',
      `🕒 Update Time : ${data.eventTime}`,
      `📌 Status      : ${statusLabel || 'Running'}`,
      MESSAGE_DIVIDER,
    ]);
  }

  if (templateKey === 'SIGNAL_STOPLOSS') {
    return compactMessage([
      ...buildSignalHeader('⚠️', data),
      '❌ STOP LOSS HIT',
      MESSAGE_DIVIDER,
      `💹 Entry Price : ${data.entryPrice}`,
      `🛑 Stop Loss   : ${data.stopLoss}`,
      `🚪 Exit Price  : ${data.exitPrice}`,
      `📊 Net Points  : ${data.pointsLabel}`,
      '',
      `🕒 Exit Time   : ${data.exitTime}`,
      `📌 Status      : ${statusLabel || 'Closed'}`,
      MESSAGE_DIVIDER,
    ]);
  }

  if (templateKey === 'SIGNAL_INFO') {
    return compactMessage([
      ...buildSignalHeader('🔄', data),
      targetLevel.startsWith('TP') ? `🔔 ${targetLevel} UPDATE` : '🔔 SIGNAL UPDATE',
      MESSAGE_DIVIDER,
      `💹 Entry Price : ${data.entryPrice}`,
      `📈 Current     : ${data.currentPrice}`,
      hasDisplayValue(data.targetPrice) ? `🎯 Target Price: ${data.targetPrice}` : null,
      hasDisplayValue(data.pointsLabel) ? `📊 Net Points  : ${data.pointsLabel}` : null,
      '',
      ...buildTargetLines(data),
      hasDisplayValue(updateMessage) ? '' : null,
      hasDisplayValue(updateMessage) ? `📍 Update      : ${updateMessage}` : null,
      '',
      `🕒 Update Time : ${data.eventTime}`,
      `📌 Status      : ${statusLabel || 'Active'}`,
      MESSAGE_DIVIDER,
    ]);
  }

  const isClosedUpdate = isClosedSignalStatus(statusLabel) || statusLabel.toLowerCase() === 'closed';
  return compactMessage([
    ...buildSignalHeader(isClosedUpdate ? '📘' : '🔄', data),
    isClosedUpdate ? '✅ TRADE CLOSED' : '🔔 SIGNAL UPDATE',
    MESSAGE_DIVIDER,
    `💹 Entry Price : ${data.entryPrice}`,
    hasDisplayValue(data.currentPrice) ? `📈 Current     : ${data.currentPrice}` : null,
    hasDisplayValue(data.exitPrice) ? `🚪 Exit Price  : ${data.exitPrice}` : null,
    hasDisplayValue(updateMessage) ? `📍 Update      : ${updateMessage}` : null,
    '',
    `🕒 Update Time : ${data.eventTime}`,
    `📌 Status      : ${statusLabel || (isClosedUpdate ? 'Closed' : 'Active')}`,
    MESSAGE_DIVIDER,
  ]);
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

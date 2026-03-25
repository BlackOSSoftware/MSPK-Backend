import test from 'node:test';
import assert from 'node:assert/strict';

import notificationTemplates from '../config/notificationTemplates.js';
import {
  buildSignalChannelMessage,
  buildSignalTemplateData,
  isClosedSignalStatus,
  renderNotificationTemplate,
  resolveDisplayTimestamp,
} from './notificationFormatter.js';
import { parseSignalTimestamp } from './signalTimestamp.js';

test('parseSignalTimestamp treats timezone-less webhook timestamps as IST', () => {
  const parsed = parseSignalTimestamp('2026-03-19T18:00:00');
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.toISOString(), '2026-03-19T12:30:00.000Z');
});

test('resolveDisplayTimestamp keeps the real entry time instead of createdAt', () => {
  const resolved = resolveDisplayTimestamp({
    primary: '2026-03-19T18:00:00',
    fallback: '2026-03-19T18:05:00+05:30',
    timeframe: '5m',
  });

  assert.ok(resolved instanceof Date);
  assert.equal(resolved.toISOString(), '2026-03-19T12:30:00.000Z');
});

test('resolveDisplayTimestamp falls back when webhook time is unrealistically ahead', () => {
  const resolved = resolveDisplayTimestamp({
    primary: '2026-03-19T23:45:00+05:30',
    fallback: '2026-03-19T18:05:00+05:30',
    timeframe: '5m',
  });

  assert.ok(resolved instanceof Date);
  assert.equal(resolved.toISOString(), '2026-03-19T12:35:00.000Z');
});

test('resolveDisplayTimestamp keeps delayed webhook time instead of createdAt', () => {
  const resolved = resolveDisplayTimestamp({
    primary: '2026-03-19T10:00:00',
    fallback: '2026-03-19T19:45:04+05:30',
    timeframe: '15m',
  });

  assert.ok(resolved instanceof Date);
  assert.equal(resolved.toISOString(), '2026-03-19T04:30:00.000Z');
});

test('resolveDisplayTimestamp prefers actual alert time when webhook timestamp is candle start', () => {
  const resolved = resolveDisplayTimestamp({
    primary: '2026-03-23T19:00:00+05:30',
    fallback: '2026-03-23T19:05:08+05:30',
    timeframe: '5m',
  });

  assert.ok(resolved instanceof Date);
  assert.equal(resolved.toISOString(), '2026-03-23T13:35:08.000Z');
});

test('resolveDisplayTimestamp prevents exit time from rendering before entry time', () => {
  const entryTime = parseSignalTimestamp('2026-03-19T18:00:00');
  const resolved = resolveDisplayTimestamp({
    primary: '2026-03-19T17:50:00',
    fallback: '2026-03-19T18:20:00',
    timeframe: '15m',
    floor: entryTime,
  });

  assert.ok(resolved instanceof Date);
  assert.equal(resolved.toISOString(), '2026-03-19T12:50:00.000Z');
});

test('isClosedSignalStatus only treats settled statuses as closed', () => {
  assert.equal(isClosedSignalStatus('Active'), false);
  assert.equal(isClosedSignalStatus('Open'), false);
  assert.equal(isClosedSignalStatus('Target Hit'), true);
  assert.equal(isClosedSignalStatus('Closed'), true);
});

test('buildSignalTemplateData keeps exit time blank for active signals', () => {
  const data = buildSignalTemplateData({
    status: 'Active',
    symbol: 'XAUUSD',
    timeframe: '5m',
    signalTime: '2026-03-19T09:50:00',
    updatedAt: '2026-03-19T19:25:00+05:30',
    createdAt: '2026-03-19T09:50:00+05:30',
  });

  assert.equal(data.signalTime, '19 Mar 2026, 9:50 am');
  assert.equal(data.exitTime, '-');
});

test('buildSignalTemplateData keeps raw delayed entry and exit times', () => {
  const data = buildSignalTemplateData({
    status: 'Stoploss Hit',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    signalTime: '2026-03-21T17:00:00+05:30',
    exitTime: '2026-03-21T20:25:00+05:30',
    createdAt: '2026-03-21T23:30:04+05:30',
    updatedAt: '2026-03-22T02:00:03+05:30',
  });

  assert.equal(data.signalTime, '21 Mar 2026, 5:00 pm');
  assert.equal(data.exitTime, '21 Mar 2026, 8:25 pm');
});

test('buildSignalTemplateData shows candle-close entry time when signal arrives one timeframe later', () => {
  const data = buildSignalTemplateData({
    status: 'Active',
    symbol: 'MCX:SILVER',
    timeframe: '5m',
    type: 'SELL',
    signalTime: '2026-03-23T19:00:00+05:30',
    createdAt: '2026-03-23T19:05:08+05:30',
    entryPrice: 220219.75,
    stopLoss: 224398.87,
    targets: {
      target1: 218143.72,
      target2: 216067.68,
      target3: 213991.65,
    },
  });

  assert.equal(data.signalTime, '23 Mar 2026, 7:05 pm');
  assert.equal(data.entryTime, '23 Mar 2026, 7:05 pm');
});

test('buildSignalTemplateData uses delivery time for new signals even when webhook signal time is stale', () => {
  const data = buildSignalTemplateData({
    subType: 'SIGNAL_NEW',
    status: 'Active',
    symbol: 'XAUUSD',
    timeframe: '5m',
    type: 'SELL',
    signalTime: '2026-03-23T11:20:00+05:30',
    createdAt: '2026-03-23T20:55:04+05:30',
    entryPrice: 4447.16,
    stopLoss: 4489.63,
    targets: {
      target1: 4416.58,
      target2: 4386.01,
      target3: 4355.43,
    },
  });

  assert.equal(data.signalTime, '23 Mar 2026, 8:55 pm');
  assert.equal(data.entryTime, '23 Mar 2026, 8:55 pm');
});

test('buildSignalTemplateData uses updatedAt as update time for signal info notifications', () => {
  const data = buildSignalTemplateData({
    subType: 'SIGNAL_INFO',
    status: 'Active',
    symbol: 'BTCUSDT',
    timeframe: '5m',
    type: 'BUY',
    signalTime: '2026-03-23T13:00:00+05:30',
    createdAt: '2026-03-23T18:35:03+05:30',
    updatedAt: '2026-03-23T19:25:04+05:30',
    infoTime: '2026-03-23T13:50:00+05:30',
    entryPrice: 70758.47,
    currentPrice: 71302.89,
    targetLevel: 'TP2',
    targets: {
      target1: 71025.56,
      target2: 71292.65,
      target3: 71559.74,
    },
  });

  assert.equal(data.signalTime, '23 Mar 2026, 1:00 pm');
  assert.equal(data.eventTime, '23 Mar 2026, 7:25 pm');
});

test('buildSignalChannelMessage formats info update time from the actual update timestamp', () => {
  const message = buildSignalChannelMessage({
    subType: 'SIGNAL_INFO',
    status: 'Active',
    symbol: 'BTCUSDT',
    timeframe: '5m',
    type: 'BUY',
    signalTime: '2026-03-23T13:00:00+05:30',
    createdAt: '2026-03-23T18:35:03+05:30',
    updatedAt: '2026-03-23T19:25:04+05:30',
    infoTime: '2026-03-23T13:50:00+05:30',
    entryPrice: 70758.47,
    currentPrice: 71302.89,
    targetLevel: 'TP2',
    updateMessage: 'TP2 achieved at 71302.89. Trade remains active.',
    targets: {
      target1: 71025.56,
      target2: 71292.65,
      target3: 71559.74,
    },
  });

  assert.match(message, /Update Time : 23 Mar 2026, 7:25 pm/);
});

test('buildSignalTemplateData rewrites inline ISO timestamps inside update messages', () => {
  const data = buildSignalTemplateData({
    subType: 'SIGNAL_INFO',
    status: 'Active',
    symbol: 'BTCUSDT',
    timeframe: '5m',
    notes: 'TP2 achieved at 71302.89 on 2026-03-23T08:20:00.000Z. Trade remains active.',
  });

  assert.equal(
    data.updateMessage,
    'TP2 achieved at 71302.89. Trade remains active.'
  );
});

test('target update notification includes target price, points, and target ladder', () => {
  const signalData = buildSignalTemplateData({
    subType: 'SIGNAL_INFO',
    status: 'Active',
    symbol: 'MCX:GOLD',
    timeframe: '5m',
    type: 'BUY',
    signalTime: '2026-03-19T19:00:00',
    entryPrice: 145000,
    currentPrice: 145279.5,
    targetLevel: 'TP2',
    targets: {
      target1: 145140,
      target2: 145279.5,
      target3: 145420,
    },
  });

  const rendered = renderNotificationTemplate(notificationTemplates, 'SIGNAL_INFO', signalData);

  assert.match(rendered.body, /Target Price: 1,45,279\.5/);
  assert.match(rendered.body, /Points: \+279\.5/);
  assert.match(rendered.body, /Targets: TP1 1,45,140 \| TP2 1,45,279\.5 \| TP3 1,45,420/);
});

test('buildSignalChannelMessage formats new buy signals in the structured channel layout', () => {
  const message = buildSignalChannelMessage({
    subType: 'SIGNAL_NEW',
    status: 'Active',
    symbol: 'NIFTY 50 INDEX',
    timeframe: '1h',
    type: 'BUY',
    signalTime: '2026-03-20T20:15:00+05:30',
    entryPrice: 23050.5,
    stopLoss: 23252.6,
    targets: {
      target1: 22816.75,
      target2: 22583,
      target3: 22349.25,
    },
  });

  assert.match(message, /📈 BUY SIGNAL/);
  assert.match(message, /💹 Entry Price : 23,050\.5/);
  assert.match(message, /🛑 Stop Loss   : 23,252\.6/);
  assert.match(message, /TP1            : 22,816\.75/);
  assert.match(message, /📌 Status      : Active/);
});

test('buildSignalChannelMessage formats stoploss signals in the structured channel layout', () => {
  const message = buildSignalChannelMessage({
    subType: 'SIGNAL_STOPLOSS',
    status: 'Stoploss Hit',
    symbol: 'BANKNIFTY',
    timeframe: '15m',
    type: 'SELL',
    signalTime: '2026-03-20T10:00:00+05:30',
    exitTime: '2026-03-20T10:45:00+05:30',
    entryPrice: 51000,
    stopLoss: 51120,
    exitPrice: 51120,
    totalPoints: -120,
  });

  assert.match(message, /❌ STOP LOSS HIT/);
  assert.match(message, /🛑 Stop Loss   : 51,120/);
  assert.match(message, /🚪 Exit Price  : 51,120/);
  assert.match(message, /📊 Net Points  : -120/);
  assert.match(message, /📌 Status      : Stoploss Hit/);
});

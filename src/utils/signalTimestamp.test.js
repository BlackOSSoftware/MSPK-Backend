import test from 'node:test';
import assert from 'node:assert/strict';

import notificationTemplates from '../config/notificationTemplates.js';
import {
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

test('resolveDisplayTimestamp falls back when webhook time is unrealistically stale', () => {
  const resolved = resolveDisplayTimestamp({
    primary: '2026-03-19T10:00:00',
    fallback: '2026-03-19T19:45:04+05:30',
    timeframe: '15m',
  });

  assert.ok(resolved instanceof Date);
  assert.equal(resolved.toISOString(), '2026-03-19T14:15:04.000Z');
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

test('buildSignalTemplateData prefers createdAt when signal_time is stale by many hours', () => {
  const data = buildSignalTemplateData({
    status: 'Active',
    symbol: 'XAUUSD',
    timeframe: '15m',
    signalTime: '2026-03-19T10:00:00',
    createdAt: '2026-03-19T19:45:04+05:30',
    updatedAt: '2026-03-19T19:45:04+05:30',
  });

  assert.equal(data.signalTime, '19 Mar 2026, 7:45 pm');
  assert.equal(data.exitTime, '-');
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

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDisplayTimestamp } from './notificationFormatter.js';
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

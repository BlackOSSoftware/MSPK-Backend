import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSignalTimestamp } from './signalTimestamp.js';

test('parseSignalTimestamp keeps IST parsing for Indian market webhook timestamps', () => {
  const parsed = parseSignalTimestamp('2026-03-24T16:40:00', {
    segment: 'COMMODITY',
    symbol: 'MCX:GOLD',
    referenceTime: new Date('2026-03-24T11:10:03.000Z'),
  });

  assert.ok(parsed instanceof Date);
  assert.equal(parsed.toISOString(), '2026-03-24T11:10:00.000Z');
});

test('parseSignalTimestamp chooses New York time for timezone-less XAUUSD webhook timestamps', () => {
  const parsed = parseSignalTimestamp('2026-03-24T07:05:00', {
    segment: 'COMEX',
    symbol: 'XAUUSD',
    referenceTime: new Date('2026-03-24T11:10:03.000Z'),
  });

  assert.ok(parsed instanceof Date);
  assert.equal(parsed.toISOString(), '2026-03-24T11:05:00.000Z');
});

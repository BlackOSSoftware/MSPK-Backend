import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAutoSignalSettlement,
  getSignalHighestAchievedTargetLevel,
} from './signal.service.js';

const sellSignal = {
  symbol: 'XAUUSD',
  status: 'Active',
  type: 'SELL',
  entryPrice: 4566.85,
  stopLoss: 4591.41,
  targets: {
    target1: 4550.98,
    target2: 4535.11,
    target3: 4519.24,
  },
};

test('getSignalHighestAchievedTargetLevel respects signal direction', () => {
  assert.equal(getSignalHighestAchievedTargetLevel(sellSignal, 4551.2), null);
  assert.equal(getSignalHighestAchievedTargetLevel(sellSignal, 4534.9), 'TP2');

  const buySignal = {
    type: 'BUY',
    targets: {
      target1: 100,
      target2: 110,
      target3: 120,
    },
  };

  assert.equal(getSignalHighestAchievedTargetLevel(buySignal, 114.8), 'TP2');
});

test('buildAutoSignalSettlement waits for the final target before closing', () => {
  assert.equal(buildAutoSignalSettlement(sellSignal, 4550.98), null);

  const settlement = buildAutoSignalSettlement(sellSignal, 4519.2, {
    occurredAt: '2026-03-20T17:35:00.000Z',
  });

  assert.equal(settlement?.status, 'Target Hit');
  assert.equal(settlement?.exitPrice, 4519.24);
  assert.equal(settlement?.notificationMeta?.subType, 'SIGNAL_TARGET');
  assert.equal(settlement?.notificationMeta?.data?.targetLevel, 'TP3');
});

test('buildAutoSignalSettlement closes at stop loss for adverse market moves', () => {
  const settlement = buildAutoSignalSettlement(sellSignal, 4591.41, {
    occurredAt: '2026-03-20T17:40:00.000Z',
  });

  assert.equal(settlement?.status, 'Stoploss Hit');
  assert.equal(settlement?.exitPrice, 4591.41);
  assert.equal(settlement?.notificationMeta?.subType, 'SIGNAL_STOPLOSS');
});

test('buildAutoSignalSettlement snaps auto-close time to the timeframe boundary', () => {
  const settlement = buildAutoSignalSettlement(
    {
      ...sellSignal,
      timeframe: '5m',
    },
    4591.41,
    {
      occurredAt: '2026-03-20T17:47:54.527Z',
    }
  );

  assert.ok(settlement?.exitTime instanceof Date);
  assert.equal(settlement?.exitTime.toISOString(), '2026-03-20T17:45:00.000Z');
});

test('buildAutoSignalSettlement keeps 1h auto-close times aligned to the local hour boundary', () => {
  const settlement = buildAutoSignalSettlement(
    {
      ...sellSignal,
      symbol: 'BTCUSD',
      segment: 'CRYPTO',
      timeframe: '1h',
    },
    4591.41,
    {
      occurredAt: '2026-04-03T03:17:54.527Z',
    }
  );

  assert.ok(settlement?.exitTime instanceof Date);
  assert.equal(settlement?.exitTime.toISOString(), '2026-04-03T02:30:00.000Z');
});

test('buildAutoSignalSettlement skips immediate settlement when minimum signal age is enforced', () => {
  const settlement = buildAutoSignalSettlement(
    {
      ...sellSignal,
      signalTime: '2026-03-20T17:40:00.000Z',
    },
    4591.41,
    {
      occurredAt: '2026-03-20T17:40:20.000Z',
      alignToTimeframe: false,
      minSignalAgeMs: 45 * 1000,
    }
  );

  assert.equal(settlement, null);
});

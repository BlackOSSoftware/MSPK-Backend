import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessExitSettlementCandidate,
  deriveExitStatus,
  getAllowedSignalAgeMs,
  isStopLossExitPriceConsistent,
  isValidInfoTargetProgress,
  normalizeExitWebhookPayload,
} from './webhook.controller.js';

test('isValidInfoTargetProgress rejects impossible BUY target claims', () => {
  const signal = {
    type: 'BUY',
    targets: {
      target1: 188.3128242511,
      target2: 189.4256485022,
      target3: 190.5384727533,
    },
  };

  assert.equal(
    isValidInfoTargetProgress({
      signal,
      targetLevel: 'TP1',
      price: 187.63,
    }),
    false
  );

  assert.equal(
    isValidInfoTargetProgress({
      signal,
      targetLevel: 'TP1',
      price: 188.31,
    }),
    true
  );
});

test('isValidInfoTargetProgress rejects impossible SELL target claims', () => {
  const signal = {
    type: 'SELL',
    targets: {
      target1: 99.45,
      target2: 98.9,
      target3: 98.35,
    },
  };

  assert.equal(
    isValidInfoTargetProgress({
      signal,
      targetLevel: 'TP2',
      price: 99.1,
    }),
    false
  );

  assert.equal(
    isValidInfoTargetProgress({
      signal,
      targetLevel: 'TP2',
      price: 98.9,
    }),
    true
  );
});

test('deriveExitStatus treats non-final target exits as partial profit', () => {
  const signal = {
    type: 'SELL',
    entryPrice: 4566.85,
    targets: {
      target1: 4550.98,
      target2: 4535.11,
      target3: 4519.24,
    },
  };

  assert.equal(
    deriveExitStatus({
      signal,
      exitReason: 'TARGET',
      exitPrice: 4535.11,
      totalPoints: 31.74,
    }),
    'Partial Profit Book'
  );

  assert.equal(
    deriveExitStatus({
      signal,
      exitReason: 'TARGET',
      exitPrice: 4519.24,
      totalPoints: 47.61,
    }),
    'Target Hit'
  );
});

test('getAllowedSignalAgeMs keeps delayed feed entries eligible without relaxing normal segments', () => {
  assert.equal(
    getAllowedSignalAgeMs('5m', {
      symbol: 'XAUUSD',
      segment: 'COMEX',
    }),
    12 * 60 * 60 * 1000
  );

  assert.equal(
    getAllowedSignalAgeMs('5m', {
      symbol: 'BTCUSDT',
      segment: 'CRYPTO',
    }),
    12 * 60 * 60 * 1000
  );

  assert.equal(
    getAllowedSignalAgeMs('5m', {
      symbol: 'EURUSD',
      segment: 'CURRENCY',
    }),
    12 * 60 * 60 * 1000
  );

  assert.equal(
    getAllowedSignalAgeMs('5m', {
      symbol: 'NSE:NIFTY 50-INDEX',
      segment: 'INDICES',
    }),
    90 * 60 * 1000
  );
});

test('isStopLossExitPriceConsistent rejects contaminated stoploss prices that are still inside the trade range', () => {
  const signal = {
    type: 'SELL',
    entryPrice: 67649.5,
    stopLoss: 68268.1594637916,
  };

  assert.equal(
    isStopLossExitPriceConsistent({
      signal,
      exitPrice: 67726.75,
    }),
    false
  );

  assert.equal(
    isStopLossExitPriceConsistent({
      signal,
      exitPrice: 68268.16,
    }),
    true
  );
});

test('normalizeExitWebhookPayload replaces suspicious stoploss payload fields with safe persisted values', () => {
  const signal = {
    symbol: 'BTCUSD',
    timeframe: '5m',
    type: 'SELL',
    entryPrice: 67649.5,
    stopLoss: 68268.1594637916,
    signalTime: '2026-03-31T12:10:00.000Z',
  };

  const normalized = normalizeExitWebhookPayload({
    signal,
    exitReason: 'STOP_LOSS',
    exitPrice: 67726.75,
    totalPoints: 0,
    exitTime: '2026-03-31T12:10:01.000Z',
    receivedAt: '2026-03-31T18:00:13.933Z',
  });

  assert.equal(normalized.sanitized, true);
  assert.equal(normalized.exitPrice, 68268.16);
  assert.equal(normalized.totalPoints, -618.66);
  assert.equal(normalized.exitTime.toISOString(), '2026-03-31T18:00:13.933Z');
  assert.deepEqual(normalized.sanitizedFields, ['exitPrice', 'totalPoints', 'exitTime']);
});

test('normalizeExitWebhookPayload uses receipt time when exit payload omits timeframe and arrives far after the raw exit timestamp', () => {
  const signal = {
    symbol: 'BTCUSD',
    timeframe: '5m',
    type: 'SELL',
    entryPrice: 67649.5,
    stopLoss: 68268.1594637916,
    signalTime: '2026-03-31T12:10:00.000Z',
  };

  const normalized = normalizeExitWebhookPayload({
    signal,
    exitReason: 'TARGET_HIT',
    exitPrice: 67000,
    totalPoints: 649.5,
    exitTime: '2026-03-31T12:45:00.000Z',
    receivedAt: '2026-03-31T18:30:00.000Z',
    timeframeFromPayload: '',
  });

  assert.equal(normalized.sanitized, true);
  assert.equal(normalized.exitPrice, 67000);
  assert.equal(normalized.totalPoints, 649.5);
  assert.equal(normalized.exitTime.toISOString(), '2026-03-31T18:30:00.000Z');
  assert.deepEqual(normalized.sanitizedFields, ['exitTime']);
});

test('assessExitSettlementCandidate ignores immediate EXIT near ENTRY without TP/SL confirmation', () => {
  const signal = {
    type: 'BUY',
    entryPrice: 100,
    stopLoss: 95,
    targets: {
      target1: 102,
      target2: 104,
      target3: 106,
    },
    signalTime: '2026-04-06T10:00:00.000Z',
  };

  const result = assessExitSettlementCandidate({
    signal,
    exitReason: 'EXIT_BUY',
    exitPrice: 100.1,
    totalPoints: 0.1,
    parsedExitTime: new Date('2026-04-06T10:00:20.000Z'),
    receivedAt: new Date('2026-04-06T10:00:20.000Z'),
    timeframeFromPayload: '5m',
  });

  assert.equal(result.accepted, false);
  assert.equal(result.rejectionCode, 'ignored_immediate_exit_without_execution');
});

test('assessExitSettlementCandidate ignores out-of-sequence EXIT before ENTRY', () => {
  const signal = {
    type: 'SELL',
    entryPrice: 500,
    stopLoss: 510,
    targets: {
      target1: 495,
      target2: 490,
      target3: 485,
    },
    signalTime: '2026-04-06T10:00:00.000Z',
  };

  const result = assessExitSettlementCandidate({
    signal,
    exitReason: 'TARGET_HIT',
    exitPrice: 495,
    totalPoints: 5,
    parsedExitTime: new Date('2026-04-06T09:59:59.000Z'),
    receivedAt: new Date('2026-04-06T10:05:00.000Z'),
    timeframeFromPayload: '5m',
  });

  assert.equal(result.accepted, false);
  assert.equal(result.rejectionCode, 'ignored_out_of_sequence_exit');
});

test('assessExitSettlementCandidate accepts TP exits only when target is actually reached', () => {
  const signal = {
    type: 'BUY',
    entryPrice: 100,
    stopLoss: 95,
    targets: {
      target1: 102,
      target2: 104,
      target3: 106,
    },
    signalTime: '2026-04-06T10:00:00.000Z',
  };

  const accepted = assessExitSettlementCandidate({
    signal,
    exitReason: 'TARGET_HIT',
    exitPrice: 104.2,
    totalPoints: 4.2,
    parsedExitTime: new Date('2026-04-06T10:20:00.000Z'),
    receivedAt: new Date('2026-04-06T10:20:00.000Z'),
    timeframeFromPayload: '5m',
  });

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.status, 'Partial Profit Book');

  const rejected = assessExitSettlementCandidate({
    signal,
    exitReason: 'TARGET_HIT',
    exitPrice: 101,
    totalPoints: 1,
    parsedExitTime: new Date('2026-04-06T10:20:00.000Z'),
    receivedAt: new Date('2026-04-06T10:20:00.000Z'),
    timeframeFromPayload: '5m',
  });

  assert.equal(rejected.accepted, false);
  assert.equal(rejected.rejectionCode, 'ignored_exit_without_tp_sl_confirmation');
});

test('assessExitSettlementCandidate accepts STOP_LOSS only when stop loss is actually hit', () => {
  const signal = {
    type: 'BUY',
    entryPrice: 100,
    stopLoss: 95,
    targets: {
      target1: 102,
      target2: 104,
      target3: 106,
    },
    signalTime: '2026-04-06T10:00:00.000Z',
  };

  const accepted = assessExitSettlementCandidate({
    signal,
    exitReason: 'STOP_LOSS',
    exitPrice: 94.9,
    totalPoints: -5.1,
    parsedExitTime: new Date('2026-04-06T10:15:00.000Z'),
    receivedAt: new Date('2026-04-06T10:15:00.000Z'),
    timeframeFromPayload: '5m',
  });

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.status, 'Stoploss Hit');

  const rejected = assessExitSettlementCandidate({
    signal,
    exitReason: 'STOP_LOSS',
    exitPrice: 99.5,
    totalPoints: -0.5,
    parsedExitTime: new Date('2026-04-06T10:15:00.000Z'),
    receivedAt: new Date('2026-04-06T10:15:00.000Z'),
    timeframeFromPayload: '5m',
  });

  assert.equal(rejected.accepted, false);
  assert.equal(rejected.rejectionCode, 'ignored_exit_without_tp_sl_confirmation');
});

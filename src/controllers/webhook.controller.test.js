import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveExitStatus, getAllowedSignalAgeMs, isValidInfoTargetProgress } from './webhook.controller.js';

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

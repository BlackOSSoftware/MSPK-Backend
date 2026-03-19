import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveExitedSignalType,
  selectWebhookSignalCandidate,
} from './webhookSignalMatcher.js';

test('resolveExitedSignalType reads the exited position side from trade type', () => {
  assert.equal(resolveExitedSignalType('EXIT_BUY'), 'BUY');
  assert.equal(resolveExitedSignalType('exit_sell'), 'SELL');
  assert.equal(resolveExitedSignalType('CLOSE_BUY'), 'BUY');
  assert.equal(resolveExitedSignalType('SELL'), null);
});

test('selectWebhookSignalCandidate prefers the exited signal side during transition exits', () => {
  const result = selectWebhookSignalCandidate({
    signals: [
      {
        _id: 'buy-signal',
        type: 'BUY',
        timeframe: '5m',
        signalTime: '2026-03-19T09:35:00.000Z',
        createdAt: '2026-03-19T15:10:05.386Z',
        updatedAt: '2026-03-19T15:30:10.655Z',
      },
      {
        _id: 'sell-signal',
        type: 'SELL',
        timeframe: '5m',
        signalTime: '2026-03-19T09:55:00.000Z',
        createdAt: '2026-03-19T15:30:10.580Z',
        updatedAt: '2026-03-19T15:30:11.003Z',
      },
    ],
    eventTime: '2026-03-19T09:55:00.000Z',
    timeframe: '5m',
    expectedType: 'BUY',
  });

  assert.equal(result.ambiguous, false);
  assert.equal(result.signal?._id, 'buy-signal');
});

test('selectWebhookSignalCandidate returns no match when only the wrong side exists', () => {
  const result = selectWebhookSignalCandidate({
    signals: [
      {
        _id: 'sell-signal',
        type: 'SELL',
        timeframe: '5m',
        signalTime: '2026-03-19T09:55:00.000Z',
        createdAt: '2026-03-19T15:30:10.580Z',
        updatedAt: '2026-03-19T15:30:11.003Z',
      },
    ],
    eventTime: '2026-03-19T09:55:00.000Z',
    timeframe: '5m',
    expectedType: 'BUY',
  });

  assert.equal(result.ambiguous, false);
  assert.equal(result.signal, null);
});

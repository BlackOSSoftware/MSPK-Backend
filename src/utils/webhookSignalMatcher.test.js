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

test('selectWebhookSignalCandidate does not auto-pick across multiple timeframes when timeframe is missing', () => {
  const result = selectWebhookSignalCandidate({
    signals: [
      {
        _id: 'five-minute-buy',
        type: 'BUY',
        timeframe: '5m',
        signalTime: '2026-03-20T08:25:00.000Z',
        createdAt: '2026-03-20T08:30:04.000Z',
        updatedAt: '2026-03-20T08:50:04.000Z',
      },
      {
        _id: 'fifteen-minute-buy',
        type: 'BUY',
        timeframe: '15m',
        signalTime: '2026-03-20T08:45:00.000Z',
        createdAt: '2026-03-20T09:00:11.000Z',
        updatedAt: '2026-03-20T10:10:04.000Z',
      },
    ],
    eventTime: '2026-03-20T10:05:00.000Z',
    expectedType: 'BUY',
  });

  assert.equal(result.signal, null);
  assert.equal(result.ambiguous, true);
});

test('selectWebhookSignalCandidate respects textual timeframe aliases from webhook payloads', () => {
  const result = selectWebhookSignalCandidate({
    signals: [
      {
        _id: 'five-minute-buy',
        type: 'BUY',
        timeframe: '5m',
        signalTime: '2026-03-20T08:25:00.000Z',
        createdAt: '2026-03-20T08:30:04.000Z',
        updatedAt: '2026-03-20T08:50:04.000Z',
      },
      {
        _id: 'fifteen-minute-buy',
        type: 'BUY',
        timeframe: '15m',
        signalTime: '2026-03-20T08:45:00.000Z',
        createdAt: '2026-03-20T09:00:11.000Z',
        updatedAt: '2026-03-20T10:10:04.000Z',
      },
    ],
    eventTime: '2026-03-20T10:05:00.000Z',
    timeframe: '5 Min',
    expectedType: 'BUY',
  });

  assert.equal(result.ambiguous, false);
  assert.equal(result.signal?._id, 'five-minute-buy');
});

test('selectWebhookSignalCandidate prefers an already-open leg when EXIT time equals new reversal entry time', () => {
  const result = selectWebhookSignalCandidate({
    signals: [
      {
        _id: 'older-buy',
        type: 'BUY',
        timeframe: '5m',
        signalTime: '2026-03-20T10:25:00.000Z',
        createdAt: '2026-03-20T10:25:02.000Z',
        updatedAt: '2026-03-20T10:30:00.000Z',
      },
      {
        _id: 'new-sell',
        type: 'SELL',
        timeframe: '5m',
        signalTime: '2026-03-20T10:35:00.000Z',
        createdAt: '2026-03-20T10:35:02.000Z',
        updatedAt: '2026-03-20T10:35:03.000Z',
      },
    ],
    eventTime: '2026-03-20T10:35:00.000Z',
    timeframe: '5m',
  });

  assert.equal(result.ambiguous, false);
  assert.equal(result.signal?._id, 'older-buy');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { getWebhookTimeframeValue, normalizeSignalTimeframe } from './timeframe.js';

test('normalizeSignalTimeframe understands common textual TradingView intervals', () => {
  assert.equal(normalizeSignalTimeframe('5 Min'), '5m');
  assert.equal(normalizeSignalTimeframe('15min'), '15m');
  assert.equal(normalizeSignalTimeframe('1 Hour'), '1h');
  assert.equal(normalizeSignalTimeframe('60 min'), '1h');
});

test('getWebhookTimeframeValue reads alternate webhook timeframe keys', () => {
  assert.equal(getWebhookTimeframeValue({ interval: '5' }), '5');
  assert.equal(getWebhookTimeframeValue({ resolution: '15m' }), '15m');
  assert.equal(getWebhookTimeframeValue({ chart_interval: '1 Hour' }), '1 Hour');
});

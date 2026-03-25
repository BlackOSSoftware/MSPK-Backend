import test from 'node:test';
import assert from 'node:assert/strict';
import Joi from 'joi';

import webhookValidation from './webhook.validation.js';

const validateWebhookBody = (body) =>
  Joi.compile(webhookValidation.receiveSignal)
    .prefs({ errors: { label: 'key' }, abortEarly: false })
    .validate({ body });

test('entry webhook validation preserves the raw signal_time string', () => {
  const { error, value } = validateWebhookBody({
    event: 'ENTRY',
    unique_id: 'entry-1',
    symbol: 'XAUUSD',
    trade_type: 'SELL',
    timeframe: '5m',
    entry_price: 4235.3,
    stop_loss: 4301.58,
    targets: {
      t1: 4184.14,
      t2: 4132.99,
      t3: 4081.84,
    },
    signal_time: '2026-03-23T05:40:00',
  });

  assert.equal(error, undefined);
  assert.equal(typeof value.body.signal_time, 'string');
  assert.equal(value.body.signal_time, '2026-03-23T05:40:00');
});

test('exit webhook validation preserves the raw exit_time string', () => {
  const { error, value } = validateWebhookBody({
    event: 'EXIT',
    unique_id: 'exit-1',
    symbol: 'BTCUSDT',
    trade_type: 'EXIT_SELL',
    timeframe: '5m',
    exit_price: 69264.4,
    total_points: 732.78,
    exit_reason: 'TARGET_HIT',
    exit_time: '2026-03-23T12:35:00',
  });

  assert.equal(error, undefined);
  assert.equal(typeof value.body.exit_time, 'string');
  assert.equal(value.body.exit_time, '2026-03-23T12:35:00');
});

test('info webhook validation preserves the raw time string', () => {
  const { error, value } = validateWebhookBody({
    event: 'INFO',
    unique_id: 'info-1',
    symbol: 'XAUUSD',
    trade_type: 'BUY',
    timeframe: '1h',
    message: 'TP1',
    price: 4553.12,
    time: '2026-03-23T09:10:00',
  });

  assert.equal(error, undefined);
  assert.equal(typeof value.body.time, 'string');
  assert.equal(value.body.time, '2026-03-23T09:10:00');
});

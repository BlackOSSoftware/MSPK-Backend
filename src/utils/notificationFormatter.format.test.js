import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSignalChannelMessage } from './notificationFormatter.js';

test('buildSignalChannelMessage keeps the requested sell signal channel format', () => {
  const message = buildSignalChannelMessage({
    subType: 'SIGNAL_NEW',
    status: 'Active',
    symbol: 'XAUUSD',
    timeframe: '5m',
    type: 'SELL',
    signalTime: '2026-03-23T05:40:00+05:30',
    entryPrice: 4235.3,
    stopLoss: 4301.58,
    targets: {
      target1: 4184.14,
      target2: 4132.99,
      target3: 4081.84,
    },
  });

  assert.equal(
    message,
    [
      '🔴 MSPK TRADE SOLUTIONS',
      '',
      '📊 SYMBOL     : XAUUSD',
      '⏱ TIME FRAME : 5m (5-minute)',
      '━━━━━━━━━━━━━━━━━━',
      '📉 SELL SIGNAL',
      '━━━━━━━━━━━━━━━━━━',
      '💹 Entry Price : 4,235.3',
      '🛑 Stop Loss   : 4,301.58',
      '',
      '🎯 Targets',
      'TP1            : 4,184.14',
      'TP2            : 4,132.99',
      'TP3            : 4,081.84',
      '',
      '🕒 Entry Time  : 23 Mar 2026, 5:40 am',
      '📌 Status      : Active',
      '━━━━━━━━━━━━━━━━━━',
    ].join('\n')
  );
});

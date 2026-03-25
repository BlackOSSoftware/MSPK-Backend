import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAllowedAccessFromPermissions,
  getPlanStatusFromPlanData,
  hasSignalAccessByPlan,
} from './signalAccess.js';

test('getAllowedAccessFromPermissions maps crypto only when permission exists', () => {
  const withoutCrypto = getAllowedAccessFromPermissions(['MCX_FUT', 'EQUITY_INTRA']);
  const withCrypto = getAllowedAccessFromPermissions(['MCX_FUT', 'CRYPTO']);

  assert.equal(withoutCrypto.allowedSegments.includes('CRYPTO'), false);
  assert.equal(withCrypto.allowedSegments.includes('CRYPTO'), true);
});

test('getPlanStatusFromPlanData treats permissioned custom plans as active', () => {
  assert.equal(
    getPlanStatusFromPlanData({
      planId: 'custom-plan',
      permissions: ['MCX_FUT'],
      planExpiry: '2026-04-16T06:10:46.776Z',
    }, new Date('2026-03-22T00:00:00.000Z')),
    'active'
  );
});

test('hasSignalAccessByPlan blocks crypto signal when crypto permission is missing', () => {
  const allowed = hasSignalAccessByPlan(
    {
      symbol: 'BTCUSDT',
      segment: 'CRYPTO',
      category: 'CRYPTO',
      isFree: false,
    },
    {
      planId: 'custom-plan',
      permissions: [
        'EQUITY_INTRA',
        'NIFTY_OPT',
        'FINNIFTY_OPT',
        'MCX_FUT',
        'BANKNIFTY_OPT',
        'STOCK_OPT',
        'CURRENCY',
        'EQUITY_DELIVERY',
      ],
      planExpiry: '2026-04-16T06:10:46.776Z',
    },
    new Date('2026-03-22T00:00:00.000Z')
  );

  assert.equal(allowed, false);
});

test('hasSignalAccessByPlan allows commodity signal when MCX permission exists', () => {
  const allowed = hasSignalAccessByPlan(
    {
      symbol: 'XAUUSD',
      segment: 'COMEX',
      category: 'MCX_FUT',
      isFree: false,
    },
    {
      planId: 'custom-plan',
      permissions: ['MCX_FUT'],
      planExpiry: '2026-04-16T06:10:46.776Z',
    },
    new Date('2026-03-22T00:00:00.000Z')
  );

  assert.equal(allowed, true);
});

test('hasSignalAccessByPlan allows free signal even when plan is expired', () => {
  const allowed = hasSignalAccessByPlan(
    {
      symbol: 'BTCUSDT',
      segment: 'CRYPTO',
      category: 'CRYPTO',
      isFree: true,
    },
    {
      planId: null,
      permissions: [],
      planExpiry: null,
    },
    new Date('2026-03-22T00:00:00.000Z')
  );

  assert.equal(allowed, true);
});

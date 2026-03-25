import test from 'node:test';
import assert from 'node:assert/strict';

import { getLegacyPlanAudienceGroups, getLegacyPlanPermissions } from './legacyPlanAccess.js';

test('custom legacy plan names stay conservative instead of getting all segments', () => {
  assert.deepEqual(getLegacyPlanPermissions('Custom As User Requirement'), []);
  assert.deepEqual(getLegacyPlanAudienceGroups('Custom As User Requirement'), []);
});

test('legacy keyword parsing keeps only explicitly named segments', () => {
  assert.deepEqual(
    getLegacyPlanPermissions('Equity Options Commodity Currency Crypto'),
    [
      'CRYPTO',
      'CURRENCY',
      'COMMODITY',
      'MCX_FUT',
      'EQUITY_INTRA',
      'EQUITY_DELIVERY',
      'NIFTY_OPT',
      'BANKNIFTY_OPT',
    ]
  );
  assert.deepEqual(
    getLegacyPlanAudienceGroups('Equity Options Commodity Currency Crypto'),
    ['EQUITY', 'FNO', 'COMMODITY', 'CURRENCY', 'CRYPTO']
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLegacyMasterSymbolId,
  buildMasterSymbolId,
  buildStableFrontMonthFutureSymbolId,
  looksLikeMasterSymbolId,
} from './masterSymbolId.js';

test('buildMasterSymbolId uses stable CURRENT key for front-month futures', () => {
  const doc = {
    _id: '69c9e1dc0fdf0acd045487c6',
    symbol: 'NFO:BANKNIFTY26APRFUT',
    segment: 'FNO',
    exchange: 'NFO',
  };
  const referenceDate = new Date('2026-03-30T10:00:00+05:30');

  assert.equal(
    buildStableFrontMonthFutureSymbolId(doc, { referenceDate }),
    'FNO-NFO-BANKNIFTY-CURRENT'
  );
  assert.equal(
    buildMasterSymbolId(doc, { referenceDate }),
    'FNO-NFO-BANKNIFTY-CURRENT'
  );
});

test('buildMasterSymbolId keeps legacy mongo-based format for non-futures', () => {
  const doc = {
    _id: '69c9e1dc0fdf0acd045487c6',
    symbol: 'NSE:BANKNIFTY',
    segment: 'INDICES',
    exchange: 'NSE',
  };

  assert.equal(
    buildLegacyMasterSymbolId(doc),
    'INDICES-NSE-BANKNIFTY-69c9e1dc0fdf0acd045487c6'
  );
  assert.equal(
    buildMasterSymbolId(doc, { referenceDate: new Date('2026-03-30T10:00:00+05:30') }),
    'INDICES-NSE-BANKNIFTY-69c9e1dc0fdf0acd045487c6'
  );
});

test('looksLikeMasterSymbolId accepts both legacy and stable formats', () => {
  assert.equal(looksLikeMasterSymbolId('FNO-NFO-BANKNIFTY-CURRENT'), true);
  assert.equal(looksLikeMasterSymbolId('INDICES-NSE-BANKNIFTY-69c9e1dc0fdf0acd045487c6'), true);
  assert.equal(looksLikeMasterSymbolId('NFO:BANKNIFTY26APRFUT'), false);
});

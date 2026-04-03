import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getContractReferenceMonthYear,
  isCurrentMonthContractDoc,
  isCurrentMonthExpiry,
} from './currentMonthContracts.js';

test('NFO contracts roll to the next month after the monthly expiry date passes', () => {
  const referenceDate = new Date('2026-03-29T10:00:00+05:30');
  const marchContract = {
    symbol: 'NFO:BANKNIFTY26MARFUT',
    exchange: 'NFO',
    segment: 'FNO',
  };
  const aprilContract = {
    symbol: 'NFO:BANKNIFTY26APRFUT',
    exchange: 'NFO',
    segment: 'FNO',
  };

  assert.deepEqual(getContractReferenceMonthYear(marchContract, referenceDate), {
    year: 2026,
    month: 3,
  });
  assert.equal(isCurrentMonthContractDoc(marchContract, referenceDate), false);
  assert.equal(isCurrentMonthContractDoc(aprilContract, referenceDate), true);
  assert.equal(
    isCurrentMonthExpiry('2026-03-26', referenceDate, { exchange: 'NFO', segment: 'FNO' }),
    false
  );
  assert.equal(
    isCurrentMonthExpiry('2026-04-30', referenceDate, { exchange: 'NFO', segment: 'FNO' }),
    true
  );
});

test('NFO contracts stay on the same month through expiry day', () => {
  const referenceDate = new Date('2026-03-26T10:00:00+05:30');
  const marchContract = {
    symbol: 'NFO:BANKNIFTY26MARFUT',
    exchange: 'NFO',
    segment: 'FNO',
  };
  const aprilContract = {
    symbol: 'NFO:BANKNIFTY26APRFUT',
    exchange: 'NFO',
    segment: 'FNO',
  };

  assert.deepEqual(getContractReferenceMonthYear(marchContract, referenceDate), {
    year: 2026,
    month: 2,
  });
  assert.equal(isCurrentMonthContractDoc(marchContract, referenceDate), true);
  assert.equal(isCurrentMonthContractDoc(aprilContract, referenceDate), false);
});

test('Non-derivative symbols are not filtered out by contract-month checks', () => {
  const referenceDate = new Date('2026-03-29T10:00:00+05:30');

  assert.equal(
    isCurrentMonthContractDoc({
      symbol: 'NSE:BANKNIFTY',
      exchange: 'NSE',
      segment: 'INDICES',
      name: 'Nifty Bank Index',
    }, referenceDate),
    true
  );
});

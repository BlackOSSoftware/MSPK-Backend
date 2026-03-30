import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSelectedSignalFilter, expandSelectedSymbols } from './userSignalSelection.js';

test('expandSelectedSymbols keeps global commodity aliases in one continuity bucket', () => {
  const xauAliases = expandSelectedSymbols(['XAUUSD']);
  assert.equal(xauAliases.includes('GC1!'), true);
  assert.equal(xauAliases.includes('COMEX:GC1!'), true);
  assert.equal(xauAliases.includes('GOLD'), true);

  const silverAliases = expandSelectedSymbols(['SI1!']);
  assert.equal(silverAliases.includes('XAGUSD'), true);
  assert.equal(silverAliases.includes('MCX:SILVER'), true);
});

test('buildSelectedSignalFilter includes known aliases for metals and futures symbols', () => {
  const filter = buildSelectedSignalFilter(['XAGUSD']);
  const values = Array.isArray(filter?.symbol?.$in) ? filter.symbol.$in : [];

  assert.equal(values.includes('SI1!'), true);
  assert.equal(values.includes('COMEX:SI1!'), true);
  assert.equal(values.includes('MCX:SILVER'), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMarketSymbolAliasDefinition,
  getMarketSymbolAliasDefinitionBySymbol,
} from './marketSymbolAliases.js';
import { expandSelectedSymbols } from './userSignalSelection.js';

test('getMarketSymbolAliasDefinition resolves GCI to the gold continuous future', () => {
  const definition = getMarketSymbolAliasDefinition('GCI');

  assert.ok(definition);
  assert.equal(definition.alias, 'GCI');
  assert.equal(definition.canonical, 'GC1!');
});

test('expandSelectedSymbols treats GCI and GC1! as the same signal family', () => {
  const fromAlias = expandSelectedSymbols(['GCI']);
  const fromCanonical = expandSelectedSymbols(['GC1!']);

  assert.deepEqual(
    [...new Set(fromAlias)].sort(),
    ['GC1!', 'GCI']
  );
  assert.deepEqual(
    [...new Set(fromCanonical)].sort(),
    ['GC1!', 'GCI']
  );
});

test('getMarketSymbolAliasDefinitionBySymbol resolves the canonical gold future to GCI metadata', () => {
  const definition = getMarketSymbolAliasDefinitionBySymbol('GC1!');

  assert.ok(definition);
  assert.equal(definition.alias, 'GCI');
  assert.equal(definition.canonical, 'GC1!');
  assert.equal(definition.name, 'Gold Futures Continuous');
});

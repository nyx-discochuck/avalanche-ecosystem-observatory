import assert from 'node:assert/strict';
import test from 'node:test';
import { formatValue } from '../src/formatters.mjs';

test('AVAX fees retain meaningful precision below one milli-AVAX', () => {
  assert.equal(formatValue(0.00010013755750679959, 'AVAX'), '0.00010014 AVAX');
  assert.equal(formatValue(0.000003892450844319, 'AVAX'), '0.00000389 AVAX');
  assert.notEqual(formatValue(0.00010013755750679959, 'AVAX'), '0 AVAX');
});

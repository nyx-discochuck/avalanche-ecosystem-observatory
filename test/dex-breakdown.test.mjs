import assert from 'node:assert/strict';
import test from 'node:test';
import {
  combineDexLiquiditySources,
  rankDexLiquiditySourceKeys,
} from '../src/dex-breakdown.mjs';

const rowTotal = (row) => Object.entries(row)
  .filter(([key]) => key !== 'date')
  .reduce((total, [, value]) => total + Number(value || 0), 0);

test('all Pharaoh adapters combine into one liquidity source without changing daily volume', () => {
  const raw = [{
    date: '2026-07-26',
    'Pharaoh CL': 6,
    'Pharaoh Legacy': 2,
    'Pharaoh V3 Legacy': 4,
    'Pharaoh V3': 18,
    'Pharaoh DLMM': 21,
    'Joe V2.2': 8,
  }];

  const [combined] = combineDexLiquiditySources(raw);

  assert.deepEqual(combined, {
    date: '2026-07-26',
    'Joe V2.2': 8,
    Pharaoh: 51,
  });
  assert.equal(rowTotal(combined), rowTotal(raw[0]));
});

test('an already-canonical Pharaoh row is safely folded with migration adapters', () => {
  const [combined] = combineDexLiquiditySources([{
    date: '2026-07-27',
    Pharaoh: 5,
    'pharaoh v3': 7,
    'Uniswap V3': 3,
  }]);

  assert.deepEqual(combined, {
    date: '2026-07-27',
    'Uniswap V3': 3,
    Pharaoh: 12,
  });
});

test('liquidity-source keys rank by volume over the supplied chart window', () => {
  const keys = rankDexLiquiditySourceKeys([
    { date: '2026-07-26', Joe: 20, Pharaoh: 30, Uniswap: 25 },
    { date: '2026-07-27', Joe: 20, Pharaoh: 40, Uniswap: 25 },
  ]);

  assert.deepEqual(keys, ['Pharaoh', 'Uniswap', 'Joe']);
});

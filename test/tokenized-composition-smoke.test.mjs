import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { composeTokenizedEvidence } from '../scripts/tokenized-dashboard.mjs';

const collector = await readFile(new URL('../scripts/collect.mjs', import.meta.url), 'utf8');

test('tokenized composition executes without removed value-source globals', () => {
  assert.doesNotMatch(collector, /tokenValueSources|verifiedRwaSlugs/);
  const canonicalSnapshot = {
    valueHistory: [{ date: '2026-09-17', total: 799_000_000 }],
    assets: [{ id: 'buidl', valueUsd: { value: 564_000_000 } }],
  };
  const comparators = [{ assetId: 'buidl', valueUsd: 565_000_000, source: 'RWA.xyz' }];
  const composed = composeTokenizedEvidence({ canonicalSnapshot, comparators });
  assert.deepEqual(composed.valueHistory, [{ date: '2026-09-17', total: 799_000_000 }]);
  assert.deepEqual(composed.comparators, comparators);
  assert.equal(canonicalSnapshot.assets[0].valueUsd.value, 564_000_000);
});

test('comparator-only evidence cannot fabricate canonical value history', () => {
  const composed = composeTokenizedEvidence({ canonicalSnapshot: { assets: [] }, comparators: [{ valueUsd: 100 }] });
  assert.deepEqual(composed.valueHistory, []);
  assert.equal(composed.comparators[0].valueUsd, 100);
});

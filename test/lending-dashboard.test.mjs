import test from 'node:test';
import assert from 'node:assert/strict';
import { updateDashboardLending } from '../scripts/lending-dashboard.mjs';

test('lending-only publication removes six-family aliases and preserves unrelated snapshot clocks and data', () => {
  const before = { generatedAt: '2026-09-16T00:00:00Z', metadata: { freshness: 'healthy' }, overview: { tvl: 42 }, spot: { rows: [1] }, quality: { sourceHealth: [{ id: 'unrelated', ok: true }] }, lending: { markets: [{ id: 'duplicate', protocol: 'benqi-lending' }, { id: 'duplicate2', protocol: 'aave-v4' }], history: [{ date: '2026-09-15', netTvl: 99 }] } };
  const metrics = { schema: 'couchdicks.avalanche.lending-metrics.v4', generatedAt: '2026-09-17T13:01:00Z', observedAt: '2026-09-17T13:00:00Z', aggregates: { suppliedUsd: 100, borrowedUsd: null }, protocols: [{ slug: 'benqi' }], markets: { rows: [{ id: 'canonical', protocol: 'benqi', suppliedUsd: 100 }], protocolCoverage: [], state: 'partial' }, histories: [{ protocol: 'aave-v4', points: [{ suppliedUsd: 10 }] }] };
  const result = updateDashboardLending(before, metrics, { protocols: [{ netTvl: 25 }] });
  assert.equal(result.generatedAt, before.generatedAt);
  assert.deepEqual(result.metadata, before.metadata);
  assert.deepEqual(result.overview, before.overview);
  assert.deepEqual(result.spot, before.spot);
  assert.deepEqual(result.lending.history, before.lending.history);
  assert.equal(result.lending.kpis.totalBorrowedUsd, null);
  assert.equal(result.lending.kpis.netTvlUsd, 25);
  assert.deepEqual(result.lending.markets.map((row) => row.id), ['canonical']);
  assert.deepEqual(result.lending.sourceHistories, metrics.histories);
  assert.equal(before.lending.markets.length, 2);
});


test('canonical health uses the current materializer, not obsolete Llama price coverage', async () => {
  const { canonicalLendingSourceHealth } = await import('../scripts/lending-dashboard.mjs');
  const current = { acquisition: { retainedLastGood: false }, markets: { state: 'partial', rows: [{}] }, sourceHealth: { errors: [] } };
  assert.equal(canonicalLendingSourceHealth(current).ok, true);
  assert.equal(canonicalLendingSourceHealth({ ...current, acquisition: { retainedLastGood: true } }).ok, false);
  assert.equal(canonicalLendingSourceHealth({ ...current, sourceHealth: { errors: [{ protocol: 'aave-v3' }] } }).ok, false);
  assert.equal(canonicalLendingSourceHealth({ ...current, markets: { state: 'unavailable', rows: [] } }).ok, false);
});

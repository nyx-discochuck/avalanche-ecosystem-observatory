import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMaterializedLending, validateMaterializedLending, retainPartialLiquidationHistory } from '../scripts/lending-materialized.mjs';

const addr = (byte) => `0x${byte.repeat(40)}`;
test('retained events preserve dates without certifying completeness or Silo zeros', () => {
  const old = { observedAt: '2026-09-16T00:00:00Z', events: [{ protocol: 'aave-v3', liquidator: 'wrong-topic' }], history: [{ date: '2026-09-15', events: 2 }], protocols: [{ protocol: 'silo-v2', events: 0, debtRepaidUsd: 0 }], coverage: { eventCountsExact: true } };
  const retained = retainPartialLiquidationHistory(old);
  assert.equal(retained.observedAt, old.observedAt);
  assert.deepEqual(retained.history, old.history);
  assert.equal(retained.coverage.eventCountsExact, false);
  assert.equal(retained.protocols[0].events, null);
  assert.equal(retained.events[0].liquidator, null);
  assert.equal(old.coverage.eventCountsExact, true);
});
const coverage = ['aave-v3', 'aave-v4', 'benqi', 'euler-v2', 'silo-v2', 'silo-v3'].map((protocol) => ({
  protocol, name: protocol, discovered: protocol === 'euler-v2' ? 251 : 1, queried: protocol === 'euler-v2' ? 251 : 1,
  eligible: 1, priced: 1, excluded: protocol === 'euler-v2' ? 250 : 0, availability: 'available', paginationComplete: protocol === 'euler-v2' ? true : undefined,
  sourceUrl: 'https://example.com/source', fieldProvenance: {},
}));
const base = {
  schema: 'couchdicks.avalanche.lending-materialized.v1', chainId: 43114, observedAt: '2026-09-17T13:00:00Z', source: { owner: 'avax-radar' }, coverage,
  markets: coverage.map((item, index) => ({
    protocol: item.protocol, marketAddress: addr(String(index + 1)), assetAddress: addr(String.fromCharCode(97 + index)), symbol: 'USD', marketName: item.protocol,
    suppliedUsd: 100, borrowedUsd: 40, availableLiquidityUsd: 60, netTvlUsd: 60, rateBasis: /^silo/.test(item.protocol) ? 'APR' : 'APY',
    supplyRatePct: 2, borrowRatePct: 4, incentiveRatePct: null, incentiveAvailability: 'unavailable', includedInHeadline: true,
    accountingLevel: item.protocol === 'aave-v4' ? 'hub' : 'market', protectedAssets: /^silo/.test(item.protocol) ? 5 : undefined,
    borrowableAssets: /^silo/.test(item.protocol) ? 95 : undefined,
  })),
};

test('canonical materialization aggregates qualified rows without Aave V4 spoke or impaired double counting', () => {
  const input = structuredClone(base);
  input.markets.push({ ...input.markets[1], id: 'spoke', spokeAddress: addr('f'), includedInHeadline: false, accountingLevel: 'spoke' });
  input.markets.push({ ...input.markets[3], id: 'impaired', marketAddress: addr('9'), status: 'impaired', suppliedUsd: 1_000_000 });
  const result = normalizeMaterializedLending(input, { now: Date.parse('2026-09-17T13:01:00Z') });
  assert.equal(result.aggregates.suppliedUsd, 600);
  assert.equal(result.protocols.find((row) => row.slug === 'aave-v4').supplied, 100);
  assert.equal(result.markets.rows.filter((row) => row.status === 'impaired').length, 1);
});

test('materialization rejects incomplete Euler pagination and additive Aave V4 spokes', () => {
  const input = structuredClone(base);
  input.coverage.find((row) => row.protocol === 'euler-v2').paginationComplete = false;
  input.markets.find((row) => row.protocol === 'aave-v4').accountingLevel = 'spoke';
  const result = validateMaterializedLending(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.includes('Euler pagination')));
  assert.ok(result.issues.some((issue) => issue.includes('double-counts')));
});

test('riskState-only impairment, hidden and explicitly ineligible rows never reach headlines', () => {
  const input = structuredClone(base);
  input.markets[0].riskState = 'impaired';
  input.markets[2].eligible = false;
  input.markets[3].visibility = 'hidden';
  const result = normalizeMaterializedLending(input, { now: Date.parse('2026-09-17T13:01:00Z') });
  assert.equal(result.aggregates.suppliedUsd, 300);
  assert.equal(result.protocols.find((row) => row.slug === 'aave-v3').supplied, null);
  assert.equal(result.markets.rows.find((row) => row.protocol === 'aave-v3').status, 'impaired');
});

test('fresh envelope cannot refresh stale underlying protocol observations', () => {
  const input = structuredClone(base);
  input.markets[0].observedAt = '2026-09-16T13:00:00Z';
  const result = normalizeMaterializedLending(input, { now: Date.parse('2026-09-17T13:01:00Z') });
  assert.equal(result.protocols[0].availability, 'stale');
  assert.equal(result.protocols[0].observedAt, '2026-09-16T13:00:00Z');
});

test('materialization rejects missing protected/borrowable Silo distinction and stale age is computed at use time', () => {
  const input = structuredClone(base);
  delete input.markets.find((row) => row.protocol === 'silo-v3').borrowableAssets;
  assert.ok(validateMaterializedLending(input).issues.some((issue) => issue.includes('protected and borrowable')));
  const normalized = normalizeMaterializedLending(base, { now: Date.parse('2026-09-17T16:00:00Z'), maxAgeSeconds: 7200 });
  assert.equal(normalized.markets.state, 'stale');
  assert.equal(normalized.markets.rows[0].freshness, 'stale');
});

test('materialization rejects duplicate family coverage and impossible query accounting', () => {
  const input = structuredClone(base);
  input.coverage.push(structuredClone(input.coverage[0]));
  input.coverage.find((row) => row.protocol === 'benqi').queried = 2;
  const result = validateMaterializedLending(input);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.includes('duplicate aave-v3 coverage')));
  assert.ok(result.issues.some((issue) => issue.includes('benqi queried exceeds discovered')));
});

test('canonical incentive rate is exposed under the dashboard field without inventing unavailable rewards', () => {
  const input = structuredClone(base);
  input.markets[0].incentiveRatePct = 1.25;
  input.markets[1].incentiveRatePct = null;
  const normalized = normalizeMaterializedLending(input, { now: Date.parse('2026-09-17T13:01:00Z') });
  assert.equal(normalized.markets.rows.find((row) => row.protocol === 'aave-v3').incentiveApy, 1.25);
  assert.equal(normalized.markets.rows.find((row) => row.protocol === 'aave-v4').incentiveApy, null);
});

test('recent last-good source data stays stale despite a fresh envelope', () => {
  const input = structuredClone(base);
  input.coverage[1].retainedLastGood = true;
  input.coverage[1].freshness = 'stale';
  input.markets[1].retainedLastGood = true;
  input.markets[1].freshness = 'stale';
  const normalized = normalizeMaterializedLending(input, { now: Date.parse('2026-09-17T13:01:00Z') });
  assert.equal(normalized.protocols[1].availability, 'stale');
  assert.equal(normalized.markets.rows.find((row) => row.protocol === 'aave-v4').freshness, 'stale');
});

test('cold unavailable Euler is allowed only with no unverified rows', () => {
  const input = structuredClone(base);
  input.coverage[3] = { ...input.coverage[3], availability: 'unavailable', paginationComplete: false, queried: 0, eligible: 0, priced: 0, excluded: 0 };
  input.markets = input.markets.filter((row) => row.protocol !== 'euler-v2');
  assert.equal(validateMaterializedLending(input).valid, true);
  input.markets.push(base.markets[3]);
  assert.equal(validateMaterializedLending(input).valid, false);
});

test('partial fields retain usable supply and family observation age without inventing debt', () => {
  const input = structuredClone(base);
  input.coverage[0].observedAt = '2026-09-17T12:59:00Z';
  input.markets[0].borrowedUsd = null;
  input.markets[0].availableLiquidityUsd = '';
  const result = normalizeMaterializedLending(input, { now: Date.parse('2026-09-17T13:01:00Z') });
  const family = result.protocols[0];
  assert.equal(family.supplied, 100);
  assert.equal(family.borrowed, null);
  assert.equal(family.availableLiquidity, null);
  assert.equal(result.markets.rows.find(row => row.protocol === 'aave-v3').availableLiquidityUsd, null);
  assert.equal(family.availability, 'partial');
  assert.equal(family.fieldCoverage.borrowedUsd.available, 0);
  assert.equal(result.markets.protocolCoverage[0].observedAt, input.coverage[0].observedAt);
  assert.equal(result.markets.rows.find(row => row.protocol === 'aave-v3').ageSeconds, 120);
});

test('missing headline eligibility is not implicit approval', () => {
  const input = structuredClone(base);
  delete input.markets[0].includedInHeadline;
  assert.equal(normalizeMaterializedLending(input).protocols[0].supplied, null);
});

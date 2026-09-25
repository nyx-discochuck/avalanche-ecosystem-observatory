import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { updateDashboardTokenizedFromGateway } from '../scripts/tokenized-dashboard.mjs';

const addresses = {
  buidl: '0x53fc82f14f009009b440a706e31c9021e1196a2f',
  vbill: '0x7f4546ef315efc65336187fe3765ea779ac90183',
  acred: '0x7c64925002bfa705834b118a923e9911bee32875',
  secz: '0x5954ff4099ac47c4d6d098a9216f3278bb8c9506',
};
const observedAt = '2026-09-18T13:25:00.000Z';
function envelope(id, index) {
  const supply = 100 + index;
  return {
    id, address: addresses[id], status: 'available', valuationBasis: id === 'secz' ? 'end-of-day-equity-price' : 'fundamental-nav',
    token: {
      totalSupply: { value: supply, observedAt, availability: 'available' },
      totalSupplyRaw: { value: String(supply * 1_000_000), observedAt, availability: 'available' },
      totalSupplyExact: { value: String(supply), observedAt, availability: 'available' },
      decimals: { value: 6, observedAt, availability: 'available' },
      symbol: { value: id.toUpperCase(), observedAt, availability: 'available' },
      tokenName: { value: `${id} token`, observedAt, availability: 'available' },
      implementation: { value: `0x${String(index + 1).padStart(40, '0')}`, observedAt, availability: 'available' },
    },
    valuation: { value: 2, valueExact: '2', answerRaw: '200000000', observedAt, availability: 'available', feed: { decimals: 8, answerRaw: '200000000' } },
    valueUsd: { value: supply * 2, valueExact: String(supply * 2), observedAt, availability: 'available' },
    supplementalFeeds: [],
  };
}
function snapshot() {
  const assets = Object.keys(addresses).map(envelope);
  const aggregate = assets.reduce((sum, row) => sum + row.valueUsd.value, 0);
  return {
    schemaVersion: 'avalanche-gateway-tokenized-assets/v2', registryVersion: 'avalanche-tokenized-assets-registry/2026-09-18',
    source: 'avalanche_gateway', generatedAt: '2026-09-18T13:25:05.000Z',
    block: { number: 95592662, hash: `0x${'ab'.repeat(32)}`, timestamp: observedAt },
    coverage: { trackedAssets: 4, valuedAssets: 4, currentValuedAssets: 4, availability: 'available', includedAssetIds: Object.keys(addresses), excludedAssetIds: [] },
    aggregateValueUsd: aggregate, aggregateValueUsdExact: String(aggregate), aggregateStatus: 'complete', aggregateLabel: 'Complete eligible contract value',
    aggregateEligibility: { complete: true, eligibleAssetIds: Object.keys(addresses), excludedAssetIds: [] }, assets,
  };
}

test('minute consumer advances canonical tokenized section while preserving holders and unrelated sections', () => {
  const previousAssets = Object.keys(addresses).map((id) => ({ id, address: addresses[id], holders: 7, fieldStatus: { holders: { availability: 'available', observedAt: '2026-09-18T13:20:00.000Z' } } }));
  const dashboard = { overview: { kpis: { stablecoinMarketCapUsd: 1 } }, tokenizedAssets: { assets: previousAssets, protocols: [], kpis: { rwaAdapterTvlUsd: 55 }, activityStatus: { availability: 'available' } }, lending: { marker: 'keep' }, quality: { sourceHealth: [{ id: 'avalanche-gateway-tokenized-assets', ok: false }, { id: 'other', ok: true }] } };
  const next = updateDashboardTokenizedFromGateway(dashboard, snapshot());
  assert.equal(next.tokenizedAssets.generatedAt, '2026-09-18T13:25:05.000Z');
  assert.equal(next.tokenizedAssets.assets[0].holders, 7);
  assert.equal(next.tokenizedAssets.assets[0].fieldStatus.holders.observedAt, '2026-09-18T13:20:00.000Z');
  assert.equal(next.tokenizedAssets.assets[0].totalSupplyRaw, '100000000');
  assert.equal(next.tokenizedAssets.kpis.verifiedContractValueUsd, 812);
  assert.equal(next.overview.kpis.tokenizedAssetValueUsd, 812);
  assert.equal(next.overview.kpis.stablecoinMarketCapUsd, 1);
  assert.equal(next.lending.marker, 'keep');
  assert.equal(next.quality.sourceHealth.filter((row) => row.id === 'avalanche-gateway-tokenized-assets').length, 1);
  assert.equal(next.quality.sourceHealth.find((row) => row.id === 'avalanche-gateway-tokenized-assets').ok, true);
});

test('minute consumer rejects registry drift and propagates expired unavailable values', () => {
  const bad = snapshot(); bad.assets[0] = { ...bad.assets[0], address: addresses.vbill };
  assert.throws(() => updateDashboardTokenizedFromGateway({ tokenizedAssets: { assets: [] } }, bad), /registry mismatch/);
  const expired = snapshot(); expired.assets[0].valueUsd = { value: null, availability: 'unavailable', observedAt, error: 'expired', expired: true };
  expired.assets[0].token.totalSupply = { value: null, availability: 'unavailable', observedAt, error: 'expired', expired: true };
  expired.aggregateEligibility = { complete: false, eligibleAssetIds: ['vbill','acred','secz'], excludedAssetIds: ['buidl'] };
  expired.aggregateStatus = 'partial'; expired.aggregateLabel = 'Partial eligible contract value'; expired.aggregateValueUsd = 612; expired.aggregateValueUsdExact = '612';
  const prior = { tokenizedAssets: { assets: [{ id: 'buidl', address: addresses.buidl, totalSupply: 999, valueUsd: 999, fieldStatus: { totalSupply: { observedAt: 'old' }, valueUsd: { observedAt: 'old' } } }], kpis: { rwaAdapterTvlUsd: null } }, overview: { kpis: {} }, quality: { sourceHealth: [] } };
  const next = updateDashboardTokenizedFromGateway(prior, expired);
  assert.equal(next.tokenizedAssets.assets[0].totalSupply, null);
  assert.equal(next.tokenizedAssets.assets[0].valueUsd, null);
  assert.equal(next.tokenizedAssets.kpis.valueAvailability, 'partial');
});

test('minute publisher writes only existing systemd-authorized directories and uses a bounded Gateway read', async () => {
  const source = await readFile(new URL('../scripts/refresh-lending-dashboard.mjs', import.meta.url), 'utf8');
  assert.match(source, /TOKENIZED_CONSUMER_TIMEOUT_MS/);
  assert.match(source, /updateDashboardTokenizedFromGateway/);
  assert.match(source, /state\/dashboard\.json/);
  assert.match(source, /public\/data\/dashboard\.json/);
  assert.doesNotMatch(source, /public\/(?!data\/)/);
});

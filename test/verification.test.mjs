import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildVerificationCheck,
  parseRwaAssetPage,
  summarizeVerification,
} from '../scripts/verification.mjs';

const base = {
  id: 'example',
  category: 'test',
  label: 'Example',
  metricId: 'cross_source_verification',
  unit: 'USD',
  observedValue: 100,
  comparatorValue: 100.5,
  comparatorLabel: 'Comparator',
  sourceId: 'example-source',
  sourceName: 'Example source',
  sourceUrl: 'https://example.com',
  scope: 'Exact scope',
  tolerancePct: 1,
};

test('verification checks grade only comparable available values', () => {
  assert.equal(buildVerificationCheck(base).status, 'pass');
  assert.equal(buildVerificationCheck({ ...base, comparatorValue: 90 }).status, 'review');
  const context = buildVerificationCheck({ ...base, comparability: 'context' });
  assert.equal(context.status, 'context');
  assert.equal(context.tolerancePct, null);
  const unavailable = buildVerificationCheck({ ...base, observedValue: null });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.absoluteVariance, null);
  assert.equal(unavailable.percentVariance, null);
});

test('zero comparator never produces an invented percent variance', () => {
  const check = buildVerificationCheck({ ...base, observedValue: 0, comparatorValue: 0 });
  assert.equal(check.percentVariance, null);
  assert.equal(check.status, 'unavailable');
});

test('RWA public-page parser binds the exact Avalanche contract', () => {
  const html = `
    <script>{"net_asset_value_dollar":{"val":1.25},"tokens":[
      {"id":1,"network_name":"Avalanche C-Chain","address":"0x1111111111111111111111111111111111111111",
      "circulating_supply_token":{"val":400},"market_value_dollar":{"val":500}}
    ]}</script>
    <script type="application/ld+json">{"text":"TKN last updated 7/24/2026"}</script>
  `;
  const row = parseRwaAssetPage(html, {
    address: '0x1111111111111111111111111111111111111111',
    assetId: 'token',
    ticker: 'TKN',
    url: 'https://app.rwa.xyz/assets/TKN',
    fetchedAt: '2026-07-24T18:00:00Z',
  });
  assert.equal(row.supply, 400);
  assert.equal(row.valueUsd, 500);
  assert.equal(row.sourceAsOf, '2026-07-24');
  assert.throws(() => parseRwaAssetPage(html, {
    address: '0x2222222222222222222222222222222222222222',
    assetId: 'wrong',
    ticker: 'BAD',
  }), /exact contract/);
});

test('verification summary separates scored, contextual, and unavailable rows', () => {
  const checks = [
    buildVerificationCheck(base),
    buildVerificationCheck({ ...base, id: 'review', comparatorValue: 80 }),
    buildVerificationCheck({ ...base, id: 'context', comparability: 'context' }),
    buildVerificationCheck({ ...base, id: 'missing', comparatorValue: null }),
  ];
  assert.deepEqual(summarizeVerification(checks), {
    total: 4,
    scored: 2,
    pass: 1,
    review: 1,
    context: 1,
    unavailable: 1,
    passRatePct: 50,
    status: 'review',
  });
});

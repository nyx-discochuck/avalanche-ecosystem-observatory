import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const collector = await readFile(new URL('../scripts/collect.mjs', import.meta.url), 'utf8');
const activity = await readFile(new URL('../scripts/collect-tokenized.mjs', import.meta.url), 'utf8');
const boundedChild = await readFile(new URL('../scripts/bounded-child.mjs', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('tokenized asset supply and valuation consume only the canonical local Gateway endpoint', () => {
  assert.match(collector, /TOKENIZED_GATEWAY_URL/);
  assert.match(collector, /api\/materialized\/avalanche\/tokenized-assets/);
  const tokenSection = collector.slice(collector.indexOf('const tokenProtocols'), collector.indexOf('const tokenValuesUsd'));
  assert.doesNotMatch(tokenSection, /rpc\(RPC_URL/);
  assert.doesNotMatch(tokenSection, /defillama.*valueUsd/i);
  assert.match(tokenSection, /fieldFromSourceEnvelope\(canonical\?\.valueUsd/);
  assert.match(tokenSection, /independentObservedField/);
  assert.match(collector, /TOKENIZED_COLLECT_TIMEOUT_MS/);
  assert.match(collector, /runBoundedChild/);
  assert.match(boundedChild, /killSignal: 'SIGKILL'/);
});

test('partial canonical aggregate remains labeled partial with exclusions', () => {
  assert.match(collector, /aggregateEligibility\?\.eligibleAssetIds/);
  assert.match(collector, /aggregateEligibility\?\.excludedAssetIds/);
  assert.match(app, /Partial Contract Value/);
  assert.match(app, /excludes/);
});

test('activity collector uses a versioned full covered-day matrix fingerprint', () => {
  assert.match(activity, /materializeCoveredActivityRows\(dates, tokens, sparseRows\)/);
  assert.match(activity, /fully-covered-archive-days/);
  assert.match(activity, /ACTIVITY_IMPLEMENTATION_VERSION/);
  assert.match(activity, /existingIsFullMatrix/);
  assert.match(activity, /tokenized-activity\.v2/);
});

test('RWA scored aggregate compares the same three-asset subset and keeps SECZ unscored', () => {
  assert.match(collector, /const canonicalRequiredValueUsd = \['buidl', 'vbill', 'acred'\]/);
  const total = collector.slice(collector.indexOf("id: 'rwa-verified-contract-total'"), collector.indexOf('const verificationSummary'));
  assert.match(total, /observedValue: canonicalRequiredValueUsd/);
  assert.match(total, /SECZ is excluded from both sides/);
  const secz = collector.slice(collector.indexOf("id: 'rwa-secz-value'"), collector.indexOf("id: 'rwa-verified-contract-total'"));
  assert.match(secz, /comparability: 'context'/);
  assert.match(secz, /RedStone SECZ_EOD equity feed/);
});

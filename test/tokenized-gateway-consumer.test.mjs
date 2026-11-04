import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const collector = await readFile(new URL('../scripts/collect.mjs', import.meta.url), 'utf8');
const activity = await readFile(new URL('../scripts/collect-tokenized.mjs', import.meta.url), 'utf8');
const boundedChild = await readFile(new URL('../scripts/bounded-child.mjs', import.meta.url), 'utf8');

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

test('activity collector uses explicit covered-day zero materialization', () => {
  assert.match(activity, /materializeCoveredActivityRows\(dates, tokens, sparseRows\)/);
  assert.match(activity, /fully-covered-archive-days/);
});

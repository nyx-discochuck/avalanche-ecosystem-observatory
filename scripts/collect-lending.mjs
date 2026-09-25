import path from 'node:path';
import { ROOT, fetchJson, readJson, writeJsonAtomic } from './lib.mjs';
import { normalizeMaterializedLending, retainPartialLiquidationHistory } from './lending-materialized.mjs';

const outputFile = path.join(ROOT, 'state', 'lending-metrics.json');
const materializedUrl = process.env.LENDING_MATERIALIZED_URL || 'http://127.0.0.1:43140/api/materialized/avalanche/lending';
const previous = await readJson(outputFile, null);
const result = await fetchJson(materializedUrl, { retries: 1, timeoutMs: 20_000 });
let normalized = null;
let acquisitionError = result.ok ? null : result.error;

if (result.ok) {
  try {
    normalized = normalizeMaterializedLending(result.data);
    if (!result.data.liquidations) normalized.liquidations = retainPartialLiquidationHistory(previous?.liquidations) || normalized.liquidations;
  } catch (error) {
    acquisitionError = error instanceof Error ? error.message : String(error);
  }
}

if (normalized) {
  normalized.acquisition = { mode: 'canonical-gateway-materialization', url: materializedUrl, fetchedAt: result.fetchedAt, retainedLastGood: false };
  await writeJsonAtomic(outputFile, normalized);
  console.log(`lending: canonical snapshot ${normalized.markets.rows.length} rows at ${normalized.observedAt}`);
} else if (previous?.schema === 'couchdicks.avalanche.lending-metrics.v4' && previous?.markets?.rows?.length) {
  previous.acquisition = { mode: 'canonical-gateway-materialization', url: materializedUrl, fetchedAt: result.fetchedAt, retainedLastGood: true, error: acquisitionError };
  previous.markets.state = 'stale';
  previous.markets.rows = previous.markets.rows.map((row) => ({ ...row, freshness: 'stale', state: 'stale', retainedLastGood: true }));
  previous.protocols = (previous.protocols || []).map((row) => ({ ...row, availability: 'stale' }));
  previous.markets.protocolCoverage = (previous.markets.protocolCoverage || []).map((row) => ({ ...row, availability: 'stale', retainedLastGood: true }));
  previous.sourceHealth = { ...(previous.sourceHealth || {}), canonicalMaterializer: { ok: false, error: acquisitionError, retainedLastGood: true } };
  await writeJsonAtomic(outputFile, previous);
  console.warn(`lending: canonical materializer unavailable or invalid; retained last good snapshot (${acquisitionError})`);
} else {
  await writeJsonAtomic(outputFile, {
    schema: 'couchdicks.avalanche.lending-metrics.v4', generatedAt: result.fetchedAt, chain: 'Avalanche', network: 'Avalanche C-Chain', chainId: 43114, scope: 'Avalanche-only',
    sourceHealth: { canonicalMaterializer: { ok: false, error: acquisitionError, retainedLastGood: false } },
    acquisition: { mode: 'canonical-gateway-materialization', url: materializedUrl, fetchedAt: result.fetchedAt, retainedLastGood: false, error: acquisitionError },
    aggregates: { suppliedUsd: null, borrowedUsd: null, availableLiquidityUsd: null, netTvlUsd: null }, protocols: [],
    markets: { state: 'unavailable', observedAt: null, rows: [], protocolCoverage: [] },
    vaults: { state: 'unavailable', rows: [], protocolCoverage: [], accounting: { additive: false } },
    liquidations: retainPartialLiquidationHistory(previous?.liquidations) || { state: 'partial', events: [], history: [], protocols: [], coverage: { eventCountsExact: false, limitation: 'Canonical event materialization unavailable; zero is not asserted.' } },
  });
  console.warn(`lending: canonical materializer unavailable or invalid and no canonical last-good snapshot exists (${acquisitionError})`);
}

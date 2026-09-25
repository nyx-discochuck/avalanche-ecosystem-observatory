import { AVALANCHE_LENDING_SCOPE, partitionLendingMarkets, validateLendingMarketRow } from './lending-metrics.mjs';
import { REQUIRED_LENDING_FAMILIES } from './lending-materialized.mjs';

export const LENDING_REFERENCE_SLUGS = Object.freeze(['aave-v3', 'aave-v4', 'benqi-lending', 'euler-v2', 'silo-v2', 'silo-v3']);
const owned = new Set([...REQUIRED_LENDING_FAMILIES, 'benqi-lending']);
const sumAvailable = (values) => { const known = values.filter(Number.isFinite); return known.length ? known.reduce((a, b) => a + b, 0) : null; };

// Shared by the broad collector and the five-minute lending-only consumer.
// Current native lending never borrows another provider's number to hide gaps.
export function assembleLendingDashboard(previous = {}, metrics = {}, reference = null) {
  const rows = metrics.markets?.rows || [];
  const accepted = metrics.schema === 'couchdicks.avalanche.lending-metrics.v4';
  const legacy = [...(previous.markets || []), ...(previous.impairedMarkets || [])];
  const combined = [...legacy.filter((row) => !owned.has(row.protocol)), ...rows];
  const issues = combined.flatMap((row) => validateLendingMarketRow(row).issues.map((issue) => ({ id: row.id, issue })));
  if (issues.length) throw new Error(`invalid lending accounting: ${JSON.stringify(issues)}`);
  const partitioned = partitionLendingMarkets(combined);
  const coverage = metrics.markets?.protocolCoverage || [];
  const referenceLlama = reference || previous.referenceLlama || { sourceLabel: 'DeFiLlama retained legacy reference', protocols: [], availability: 'unavailable' };
  const aggregateCoverage = Object.fromEntries(['suppliedUsd', 'borrowedUsd', 'availableLiquidityUsd', 'netTvlUsd'].map((field) => [field, {
    available: coverage.reduce((n, row) => n + (row.fieldCoverage?.[field]?.available || 0), 0),
    eligible: coverage.reduce((n, row) => n + (row.fieldCoverage?.[field]?.eligible || 0), 0),
    partialFamilies: coverage.filter((row) => row.availability !== 'available' || (row.fieldCoverage?.[field]?.available || 0) < (row.fieldCoverage?.[field]?.eligible || 0)).map((row) => row.protocol),
  }]));
  const ledger = metrics.liquidations || {};
  return {
    ...previous, ...AVALANCHE_LENDING_SCOPE,
    updatedAt: new Date().toISOString(),
    generatedAt: metrics.generatedAt || previous.generatedAt || null,
    observedAt: metrics.observedAt || null,
    refreshExpectedSeconds: 300, staleAfterSeconds: 900,
    acquisition: metrics.acquisition || null,
    referenceLlama, aggregateCoverage,
    kpis: {
      totalSuppliedUsd: metrics.aggregates?.suppliedUsd ?? null,
      totalBorrowedUsd: metrics.aggregates?.borrowedUsd ?? null,
      netTvlUsd: sumAvailable((referenceLlama.protocols || []).map((row) => row.netTvl)),
      availableLiquidityUsd: metrics.aggregates?.availableLiquidityUsd ?? null,
      factoryVaultAssetsUsd: metrics.vaults?.grossAssetsUsd ?? null,
      liquidations30d: ledger.totalEvents ?? null,
      liquidationDebtRepaidUsd30d: ledger.debtRepaidUsd ?? null,
    },
    protocols: metrics.protocols || [],
    protocolLiquidityCoverage: (metrics.protocols || []).map((row) => ({ slug: row.slug, ...AVALANCHE_LENDING_SCOPE, availability: row.availability, fieldCoverage: row.fieldCoverage, fieldProvenance: row.fieldProvenance })),
    history: previous.history || [],
    historyCoverage: previous.historyCoverage || { sourceLabel: 'DeFiLlama retained reference', families: [...new Set((previous.history || []).flatMap((row) => Object.keys(row.protocols || {})))], observedAt: previous.generatedAt || null },
    sourceHistories: metrics.histories || [],
    markets: partitioned.ordinary, impairedMarkets: partitioned.impaired,
    marketAccountingValidation: { valid: true, issues: [] },
    marketAvailability: metrics.markets?.state || 'unavailable', marketCoverage: coverage,
    vaults: metrics.vaults?.rows || [], vaultSummary: metrics.vaults || { rows: [], protocolCoverage: [] }, vaultAvailability: metrics.vaults?.state || 'unavailable',
    liquidationHistory: ledger.history || [], liquidationEvents: ledger.events || [], liquidationProtocols: ledger.protocols || [],
    liquidationAvailability: ledger.state || 'unavailable', liquidationCoverage: ledger.coverage || null,
    fixedBlock: metrics.fixedBlock || null,
    currentAccountingSource: accepted ? 'canonical-gateway-materialization' : 'unavailable',
  };
}

export function canonicalLendingSourceHealth(metrics) {
  const failure = Boolean(metrics.acquisition?.retainedLastGood || metrics.acquisition?.error || metrics.sourceHealth?.errors?.length || metrics.markets?.state === 'stale');
  return {
    id: 'canonical-lending-materializer', ok: !failure && (metrics.markets?.rows || []).length > 0,
    fetchedAt: metrics.acquisition?.fetchedAt || null, observedAt: metrics.observedAt || null,
    availability: metrics.markets?.state || 'unavailable',
    error: metrics.acquisition?.error || (failure ? 'One or more lending sources are stale or retained after a failed refresh.' : null),
  };
}

export function updateDashboardLending(dashboard, metrics, reference) {
  const next = { ...dashboard, lending: assembleLendingDashboard(dashboard.lending, metrics, reference) };
  const oldHealth = dashboard.quality?.sourceHealth || [];
  const nativeIds = new Set(['defillama-coins', 'euler-protocol-native', 'silo-protocol-native', 'canonical-lending-materializer']);
  const sourceHealth = [...oldHealth.filter((row) => !nativeIds.has(row.id)), canonicalLendingSourceHealth(metrics)];
  next.quality = { ...dashboard.quality, sourceHealth };
  return next;
}

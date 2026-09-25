import { AVALANCHE_LENDING_SCOPE, nativeMarketState, partitionLendingMarkets } from './lending-metrics.mjs';

export const REQUIRED_LENDING_FAMILIES = Object.freeze(['aave-v3', 'aave-v4', 'benqi', 'euler-v2', 'silo-v2', 'silo-v3']);

const finite = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) && Number.isFinite(Number(value));
const address = (value) => /^0x[0-9a-f]{40}$/i.test(value || '') ? value.toLowerCase() : null;

// Current-state refreshes cannot certify an older emitter registry or indexed window.
export function retainPartialLiquidationHistory(previous) {
  if (!previous || (!previous.events?.length && !previous.history?.length)) return null;
  const ledger = structuredClone(previous);
  ledger.state = 'partial';
  ledger.coverage = {
    ...ledger.coverage, eventCountsExact: false,
    registryCompleteness: 'unverified', windowCompleteness: 'unknown',
    countScope: 'observed-events-in-retained-legacy-window',
    limitation: 'Retained historical observations, not revalidated: BENQI isolated markets and Silo generations/hooks are incomplete. Missing events are not zero. USD values are dated estimates, not necessarily cash repayment.',
  };
  ledger.protocols = (ledger.protocols || []).map((row) => ({
    ...row, state: 'partial',
    ...(String(row.protocol).startsWith('silo-') || row.events === 0 ? { events: null, pricedEvents: null, debtRepaidUsd: null } : {}),
  }));
  ledger.events = (ledger.events || []).map((row) => ({ ...row, liquidator: row.protocol === 'aave-v3' ? null : row.liquidator }));
  return ledger;
}

export function validateMaterializedLending(input, { now = Date.now(), maxAgeSeconds = 900 } = {}) {
  const issues = [];
  if (input?.schema !== 'couchdicks.avalanche.lending-materialized.v1') issues.push('unexpected materialized schema');
  if (input?.chainId !== 43114) issues.push('materialized snapshot is not Avalanche C-Chain');
  if (!Date.parse(input?.observedAt || '')) issues.push('missing valid observedAt');
  const rows = Array.isArray(input?.markets) ? input.markets : [];
  const coverage = Array.isArray(input?.coverage) ? input.coverage : [];
  const familyCounts = new Map();
  for (const row of coverage) familyCounts.set(row.protocol, (familyCounts.get(row.protocol) || 0) + 1);
  for (const protocol of REQUIRED_LENDING_FAMILIES) {
    if (!familyCounts.has(protocol)) issues.push(`missing ${protocol} coverage`);
    if ((familyCounts.get(protocol) || 0) > 1) issues.push(`duplicate ${protocol} coverage`);
  }
  for (const item of coverage) {
    if (!REQUIRED_LENDING_FAMILIES.includes(item.protocol)) issues.push(`unsupported ${item.protocol || 'unknown'} coverage`);
    for (const key of ['discovered', 'queried', 'eligible', 'priced', 'excluded']) if (!Number.isInteger(item[key]) || item[key] < 0) issues.push(`${item.protocol}.${key} is invalid`);
    if (item.queried > item.discovered) issues.push(`${item.protocol} queried exceeds discovered`);
    if (item.eligible > item.queried) issues.push(`${item.protocol} eligible exceeds queried`);
    if (item.eligible + item.excluded > item.discovered) issues.push(`${item.protocol} coverage does not reconcile`);
    if (item.priced > item.eligible) issues.push(`${item.protocol} priced exceeds eligible`);
    if (item.protocol === 'euler-v2' && item.paginationComplete !== true && !(item.availability === 'unavailable' && !rows.some((row) => row.protocol === 'euler-v2'))) issues.push('Euler pagination is incomplete');
  }
  const keys = new Set();
  for (const row of rows) {
    const marketAddress = address(row.marketAddress || row.address);
    const assetAddress = address(row.assetAddress || row.asset);
    const key = `${row.protocol}:${marketAddress}:${assetAddress}:${row.spokeAddress || ''}`;
    if (!REQUIRED_LENDING_FAMILIES.includes(row.protocol)) issues.push(`${row.protocol || 'unknown'} row has unsupported protocol`);
    if (!marketAddress || !assetAddress) issues.push(`${row.protocol || 'unknown'} row has invalid identity`);
    if (keys.has(key)) issues.push(`duplicate market identity ${key}`);
    keys.add(key);
    if (!['APR', 'APY'].includes(row.rateBasis)) issues.push(`${key} has invalid rate basis`);
    if (row.incentiveRatePct === 0 && row.incentiveAvailability === 'unavailable') issues.push(`${key} converts unavailable incentives to zero`);
    if (row.protocol === 'aave-v4' && row.accountingLevel === 'spoke' && row.includedInHeadline !== false) issues.push(`${key} double-counts an Aave V4 spoke`);
    if (/^silo-v/.test(row.protocol) && row.protectedAssets != null && row.borrowableAssets == null) issues.push(`${key} does not distinguish protected and borrowable collateral`);
  }
  const health = nativeMarketState({ required: { rows: rows.length ? rows : null }, observedAt: input?.observedAt, now, maxAgeSeconds });
  return { valid: issues.length === 0, issues, health };
}

export function normalizeMaterializedLending(input, options = {}) {
  const validation = validateMaterializedLending(input, options);
  if (!validation.valid) throw new Error(`invalid canonical lending materialization: ${validation.issues.join('; ')}`);
  const observedAt = input.observedAt;
  const rows = input.markets.map((row) => {
    const familyObservedAt = input.coverage.find((item) => item.protocol === row.protocol)?.observedAt;
    const balances = Object.fromEntries(['suppliedUsd', 'borrowedUsd', 'availableLiquidityUsd', 'netTvlUsd'].map((field) => [field, finite(row[field]) ? Number(row[field]) : null]));
    const health = nativeMarketState({
      required: { suppliedUsd: balances.suppliedUsd, borrowedUsd: balances.borrowedUsd, availableLiquidityUsd: balances.availableLiquidityUsd },
      observedAt: row.observedAt || familyObservedAt || observedAt,
      now: options.now,
      maxAgeSeconds: options.maxAgeSeconds ?? 900,
    });
    const coverage = input.coverage.find((item) => item.protocol === row.protocol);
    const retainedLastGood = row.retainedLastGood === true || coverage?.retainedLastGood === true;
    const sourceStale = row.freshness === 'stale' || coverage?.freshness === 'stale' || retainedLastGood || Boolean(row.refreshError || coverage?.refreshError);
    return {
      ...row,
      ...balances,
      includedInHeadline: row.includedInHeadline === true,
      id: row.id || `${row.protocol}:${address(row.marketAddress || row.address)}:${address(row.assetAddress || row.asset)}`,
      address: address(row.marketAddress || row.address),
      asset: address(row.assetAddress || row.asset),
      chain: AVALANCHE_LENDING_SCOPE.chain,
      network: AVALANCHE_LENDING_SCOPE.network,
      chainId: AVALANCHE_LENDING_SCOPE.chainId,
      scope: AVALANCHE_LENDING_SCOPE.scope,
      observedAt: row.observedAt || familyObservedAt || observedAt,
      incentiveApy: row.incentiveApy ?? row.incentiveRatePct ?? null,
      suppliedAssets: row.suppliedAssets ?? row.totalAssets ?? null,
      ...health,
      retainedLastGood,
      sourceAvailability: row.availability || coverage?.availability || null,
      freshness: sourceStale ? 'stale' : health.freshness,
      state: sourceStale ? 'stale' : health.state,
    };
  });
  const partitioned = partitionLendingMarkets(rows);
  const headlineRows = partitioned.ordinary.filter((row) => row.includedInHeadline === true && row.eligible !== false && row.riskState !== 'impaired' && row.visibility !== 'hidden');
  const totals = (field) => {
    const values = headlineRows.map((row) => row[field]).filter(finite).map(Number);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const protocolSummaries = REQUIRED_LENDING_FAMILIES.map((protocol) => {
    const protocolRows = headlineRows.filter((row) => row.protocol === protocol);
    const sum = (field) => {
      const values = protocolRows.map((row) => row[field]).filter(finite).map(Number);
      return values.length ? values.reduce((total, value) => total + value, 0) : null;
    };
    const covered = input.coverage.find((row) => row.protocol === protocol);
    const fieldCoverage = Object.fromEntries(['suppliedUsd', 'borrowedUsd', 'availableLiquidityUsd', 'netTvlUsd'].map((field) => [field, { available: protocolRows.filter((row) => finite(row[field])).length, eligible: protocolRows.length, scope: 'priced eligible tracked subtotal' }]));
    const denominatorField = /^silo-v/.test(protocol) ? 'borrowableSuppliedUsd' : 'suppliedUsd';
    const comparable = protocolRows.length > 0 && protocolRows.every((row) => finite(row.borrowedUsd) && finite(row[denominatorField]));
    const denominator = comparable ? sum(denominatorField) : null;
    const utilizationPct = denominator > 0 ? sum('borrowedUsd') / denominator * 100 : null;
    return {
      slug: protocol, name: covered.name || protocol, ...AVALANCHE_LENDING_SCOPE,
      supplied: sum('suppliedUsd'), borrowed: sum('borrowedUsd'), availableLiquidity: sum('availableLiquidityUsd'),
      netTvl: sum('netTvlUsd'), utilizationPct,
      utilizationFormula: utilizationPct == null ? null : `eligible borrowed USD / eligible ${denominatorField} × 100`,
      fieldCoverage,
      availability: covered.retainedLastGood || covered.freshness === 'stale' || protocolRows.some((row) => row.freshness === 'stale') ? 'stale' : protocolRows.some((row) => row.state === 'partial' || row.state === 'unavailable') ? 'partial' : covered.availability,
      observedAt: covered.observedAt || protocolRows.map((row) => row.observedAt).sort()[0] || null,
      source: covered.sourceUrl, sourceLabel: covered.sourceLabel || 'Protocol-native materializer', coverage: covered,
      fieldProvenance: covered.fieldProvenance || {},
    };
  });
  return {
    schema: 'couchdicks.avalanche.lending-metrics.v4', generatedAt: new Date(options.now || Date.now()).toISOString(), observedAt,
    ...AVALANCHE_LENDING_SCOPE, source: input.source, sourceHealth: input.sourceHealth,
    fixedBlock: input.fixedBlock || null,
    histories: input.histories || [],
    aggregates: { suppliedUsd: totals('suppliedUsd'), borrowedUsd: totals('borrowedUsd'), availableLiquidityUsd: totals('availableLiquidityUsd'), netTvlUsd: totals('netTvlUsd') },
    protocols: protocolSummaries,
    markets: { state: protocolSummaries.some((row) => row.availability === 'stale') ? 'stale' : protocolSummaries.some((row) => row.availability !== 'available') ? 'partial' : validation.health.state, observedAt, rows: [...partitioned.ordinary, ...partitioned.impaired], protocolCoverage: input.coverage.map((row) => ({ ...row, availability: protocolSummaries.find((item) => item.slug === row.protocol)?.availability, observedAt: protocolSummaries.find((item) => item.slug === row.protocol)?.observedAt || null, sourceScope: row.scope, ...AVALANCHE_LENDING_SCOPE })) },
    vaults: input.vaults || { state: 'unavailable', rows: [], protocolCoverage: [], accounting: { additive: false } },
    liquidations: input.liquidations || { state: 'partial', events: [], history: [], protocols: [], coverage: { eventCountsExact: false, limitation: 'No canonical event ledger supplied.' } },
  };
}

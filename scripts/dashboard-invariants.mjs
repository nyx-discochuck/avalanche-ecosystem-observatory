const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const finite = (value) => Number.isFinite(value);
const close = (left, right, tolerance = 0.01) => finite(left) && finite(right) && Math.abs(left - right) <= tolerance;
const utcDay = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

export function validateDashboard(payload) {
  invariant(payload?.schema === 'couchdicks.avalanche.ecosystem-dashboard.v1', 'unexpected dashboard schema');
  invariant(payload?.metadata?.chain === 'Avalanche C-Chain' && payload.metadata.chainId === 43114, 'unexpected chain metadata');
  invariant(payload.metadata.productionPath === '/avalanche/ecosystem/', 'unexpected production path');
  invariant(/^\d{4}-\d{2}-\d{2}$/.test(payload.metadata.latestCompleteDate || ''), 'latest complete date is missing');
  invariant(['healthy', 'degraded'].includes(payload.metadata.freshness), 'invalid freshness state');

  const daily = payload.blockspace?.daily || [];
  const coverage = payload.blockspace?.coverage;
  invariant(daily.length > 0 && coverage?.completeDaysOnly === true, 'blockspace complete-day coverage is missing');
  invariant(coverage.days === daily.length && coverage.start === daily[0].date && coverage.end === daily.at(-1).date, 'blockspace coverage does not reconcile');
  invariant(coverage.end === payload.metadata.latestCompleteDate, 'metadata complete date differs from blockspace coverage');
  for (const [index, row] of daily.entries()) {
    const dayStart = Date.parse(`${row.date}T00:00:00Z`) / 1000;
    const dayEnd = dayStart + 86_399;
    invariant(row.partial === false && row.first_timestamp >= dayStart && row.first_timestamp <= dayStart + 5 && row.last_timestamp >= dayEnd - 5 && row.last_timestamp <= dayEnd, `UTC boundary coverage failed for ${row.date}`);
    invariant(row.first_block <= row.last_block && row.blocks === row.last_block - row.first_block + 1, `block range is incomplete for ${row.date}`);
    invariant(row.transactions > 0 && close(row.failure_rate_pct, row.failed_transactions / row.transactions * 100, 1e-9), `transaction reconciliation failed for ${row.date}`);
    if (index) {
      invariant(utcDay(row.date) === utcDay(daily[index - 1].date) + 1, `daily coverage is not contiguous at ${row.date}`);
      invariant(row.first_block === daily[index - 1].last_block + 1, `block coverage is not contiguous at ${row.date}`);
    }
  }

  const stable = payload.overview?.stablecoins;
  const stableSymbols = new Set((stable?.assets || []).map((row) => row.symbol?.toUpperCase()));
  invariant(!stableSymbols.has('BUIDL'), 'BUIDL must not be classified as an ordinary stablecoin');
  invariant(close(stable.composition.headlineTotalUsd, stable.composition.topTenSubtotalUsd + stable.composition.otherUsd, stable.composition.roundingToleranceUsd), 'stablecoin composition does not reconcile');
  invariant(close(payload.overview.kpis.stablecoinMarketCapUsd, stable.composition.headlineTotalUsd), 'stablecoin headline differs from composition');

  const tokenized = payload.tokenizedAssets;
  const valuedRows = (tokenized?.assets || []).filter((row) => finite(row.valueUsd));
  const valuedContracts = valuedRows.length ? valuedRows.reduce((sum, row) => sum + row.valueUsd, 0) : null;
  const rwaAdapters = (tokenized?.protocols || []).reduce((sum, row) => sum + row.tvl, 0);
  invariant(valuedContracts == null
    ? tokenized.kpis.verifiedContractValueUsd == null
    : close(tokenized.kpis.verifiedContractValueUsd, valuedContracts), 'verified tokenized value does not reconcile');
  invariant(close(tokenized.kpis.rwaAdapterTvlUsd, rwaAdapters), 'RWA adapter TVL does not reconcile');
  invariant(tokenized.kpis.trackedValueUsd === tokenized.kpis.verifiedContractValueUsd, 'tracked tokenized value uses the wrong scope');
  invariant(payload.overview.kpis.tokenizedAssetValueUsd === tokenized.kpis.verifiedContractValueUsd, 'overview tokenized value uses the wrong scope');

  for (const dex of [payload.overview?.dex, payload.spot]) {
    invariant(['current-utc-day-partial', 'latest-available-utc-day'].includes(dex?.architectureCoverage?.window), 'DEX architecture window is invalid');
    const architectureDay = utcDay(dex.architectureCoverage.date);
    const generatedDay = utcDay(payload.generatedAt.slice(0, 10));
    invariant(architectureDay <= generatedDay && generatedDay - architectureDay <= 1, 'DEX architecture date is outside the accepted source lag');
    if (dex.architectureCoverage.window === 'current-utc-day-partial') invariant(architectureDay === generatedDay, 'DEX partial window is not current UTC day');
    invariant(close(dex.architectureCoverage.totalVolumeUsd, dex.architectureComposition.reduce((sum, row) => sum + row.value, 0)), 'DEX architecture composition does not reconcile');
  }
  invariant(payload.spot.volume24hLabel === 'Latest complete UTC day', 'DEX completed-day headline is mislabeled');

  invariant(Array.isArray(payload.overview?.bridges?.flowHistory) && payload.overview.bridges.flowHistory.length === 0, 'bridge flows must remain withheld');
  for (const bridge of payload.overview.bridges.protocols || []) {
    invariant(bridge.operationalStatus === 'unknown', `${bridge.name} has unsupported bridge status`);
    invariant(bridge.operationalStatusSourceUrl == null && bridge.operationalStatusCheckedAt == null, `${bridge.name} has incomplete bridge status evidence`);
  }

  const verification = payload.quality?.verification;
  invariant(verification?.schema === 'couchdicks.avalanche.verification.v1', 'unexpected verification schema');
  const counts = { pass: 0, review: 0, context: 0, unavailable: 0 };
  for (const check of verification.checks || []) {
    invariant(check.id && check.unit && check.scope && check.comparator?.sourceId && check.comparator?.url, `verification metadata is incomplete for ${check.id || 'unknown check'}`);
    invariant(Object.hasOwn(counts, check.status), `invalid verification status for ${check.id}`);
    counts[check.status] += 1;
    if (check.status === 'context') invariant(check.comparability === 'context' && check.tolerancePct == null, `${check.id} incorrectly grades contextual data`);
  }
  invariant(verification.summary.total === verification.checks.length, 'verification total does not reconcile');
  invariant(verification.summary.scored === counts.pass + counts.review, 'verification scored count does not reconcile');
  for (const key of Object.keys(counts)) invariant(verification.summary[key] === counts[key], `verification ${key} count does not reconcile`);

  const lending = payload.lending;
  const events = lending?.liquidationEvents || [];
  invariant(new Set(events.map((row) => `${row.transactionHash}:${row.logIndex}`)).size === events.length, 'liquidation events are not unique');
  invariant((lending.liquidationHistory || []).reduce((sum, row) => sum + row.events, 0) === events.length, 'liquidation daily partitions do not reconcile');
  invariant((lending.liquidationProtocols || []).reduce((sum, row) => sum + row.events, 0) === events.length, 'liquidation protocol partitions do not reconcile');
  const historyDates = new Set((lending.liquidationHistory || []).map((row) => row.date));
  invariant(events.every((row) => historyDates.has(row.date)), 'liquidation event falls outside the daily partition');
  if (lending.fixedBlock?.number != null) {
    invariant((lending.fixedBlock.rpcQuorum || []).filter((row) => row.endpoint && row.tip >= lending.fixedBlock.number).length >= 2, 'fixed-block lending snapshot lacks two independent RPC tip samples');
  } else {
    invariant(lending.currentAccountingSource === 'canonical-gateway-materialization', 'unversioned lending snapshot has neither canonical source nor fixed-block evidence');
    invariant(['aave-v3', 'aave-v4', 'benqi', 'euler-v2', 'silo-v2', 'silo-v3'].every((protocol) => lending.marketCoverage.some((row) => row.protocol === protocol)), 'canonical lending snapshot lacks an explicit family coverage record');
    invariant(lending.liquidationCoverage?.eventCountsExact === false, 'API lending snapshot cannot certify legacy liquidation completeness');
    const eligible = lending.markets.filter((row) => row.includedInHeadline !== false && row.eligible !== false && row.visibility !== 'hidden' && row.riskState !== 'impaired');
    for (const [field, kpi] of [['suppliedUsd', 'totalSuppliedUsd'], ['borrowedUsd', 'totalBorrowedUsd'], ['availableLiquidityUsd', 'availableLiquidityUsd']]) {
      const values = eligible.map((row) => row[field]).filter(finite);
      const total = values.length ? values.reduce((a, b) => a + b, 0) : null;
      invariant(total == null ? lending.kpis[kpi] == null : close(total, lending.kpis[kpi], Math.max(0.01, total * 1e-12)), `canonical lending ${field} subtotal does not reconcile`);
    }
  }
  return true;
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const [dashboard, registry, catalog, sources, lendingConfig] = await Promise.all([
  readJson('public/data/dashboard.json'),
  readJson('config/protocol-registry.json'),
  readJson('config/metric-catalog.json'),
  readJson('config/sources.json'),
  readJson('config/lending-onchain.json'),
]);
const appSource = await readFile(new URL('src/App.jsx', root), 'utf8');

test('snapshot identifies only Avalanche C-Chain', () => {
  assert.equal(dashboard.metadata.chain, 'Avalanche C-Chain');
  assert.equal(dashboard.metadata.chainId, 43114);
  assert.equal(dashboard.metadata.productionPath, '/avalanche/ecosystem/');
  assert.equal(registry.chainId, 43114);
  assert.doesNotMatch(JSON.stringify({ dashboard, registry, catalog }), /Robinhood|\/arbitrum\/|Arbitrum Orbit|Morpho page/i);
});

test('machine-readable catalogs have unique identifiers and complete methodology fields', () => {
  const metricIds = catalog.metrics.map((metric) => metric.id);
  const sourceIds = sources.sources.map((source) => source.id);
  const protocolIds = registry.protocols.map((protocol) => protocol.id);
  assert.equal(new Set(metricIds).size, metricIds.length);
  assert.equal(new Set(sourceIds).size, sourceIds.length);
  assert.equal(new Set(protocolIds).size, protocolIds.length);
  for (const metric of catalog.metrics) {
    for (const field of ['label', 'unit', 'definition', 'formula', 'sources', 'cadence', 'coverageStart', 'confidence', 'limitations']) {
      assert.ok(metric[field], `${metric.id}.${field} is required`);
    }
    for (const source of metric.sources) assert.ok(sourceIds.includes(source), `${metric.id} references unknown source ${source}`);
  }
});

test('verified contracts are valid, unique Avalanche addresses', () => {
  const addresses = registry.protocols.flatMap((protocol) => protocol.contracts.map((contract) => contract.address.toLowerCase()));
  assert.ok(addresses.length >= 9);
  assert.equal(new Set(addresses).size, addresses.length);
  for (const address of addresses) assert.match(address, /^0x[0-9a-f]{40}$/);
});

test('blockspace observations reconcile their formulas', () => {
  assert.ok(dashboard.blockspace.daily.length > 0);
  for (const [index, row] of dashboard.blockspace.daily.entries()) {
    assert.ok(row.transactions > 0);
    assert.ok(row.blocks > 0);
    assert.ok(row.fees_burned_avax > 0);
    assert.ok(row.first_block <= row.last_block);
    if (index) assert.ok(row.date > dashboard.blockspace.daily[index - 1].date);
    const expectedFailureRate = row.failed_transactions / row.transactions * 100;
    assert.ok(Math.abs(row.failure_rate_pct - expectedFailureRate) < 1e-9);
  }
});

test('headline accounting preserves nulls and avoids lending double counting', () => {
  assert.equal(dashboard.economics.kpis.issuanceAvax, null);
  assert.equal(dashboard.economics.kpis.netIssuanceAvax, null);
  assert.equal(dashboard.economics.kpis.validatorRevenueUsd, null);
  assert.deepEqual(dashboard.overview.dex.pairCategories, []);
  assert.deepEqual(dashboard.overview.bridges.flowHistory, []);
  for (const protocol of dashboard.lending.protocols) {
    assert.ok(protocol.supplied == null || Number.isFinite(protocol.supplied));
    assert.ok(protocol.availableLiquidity == null || Number.isFinite(protocol.availableLiquidity));
    assert.ok(protocol.source?.startsWith('https://'));
    assert.ok(protocol.coverage);
  }
});

test('every lending metric row is explicitly scoped to Avalanche only', () => {
  assert.deepEqual(
    { chain: dashboard.lending.chain, network: dashboard.lending.network, chainId: dashboard.lending.chainId, scope: dashboard.lending.scope },
    { chain: 'Avalanche', network: 'Avalanche C-Chain', chainId: 43114, scope: 'Avalanche-only' },
  );
  const rows = [
    ...dashboard.lending.protocols,
    ...dashboard.lending.protocolLiquidityCoverage,
    ...dashboard.lending.history,
    ...dashboard.lending.markets,
    ...dashboard.lending.impairedMarkets,
    ...dashboard.lending.marketCoverage,
    ...dashboard.lending.vaults,
    ...dashboard.lending.vaultSummary.protocolCoverage,
    ...dashboard.lending.liquidationHistory,
    ...dashboard.lending.liquidationEvents,
    ...dashboard.lending.liquidationProtocols,
  ];
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.chain === 'Avalanche' && row.chainId === 43114 && row.scope === 'Avalanche-only'));
  assert.ok(dashboard.lending.protocols.every((row) => row.coverage?.sourceUrl && row.sourceLabel));
  assert.deepEqual(dashboard.lending.protocols.map((row) => row.slug), ['aave-v3', 'aave-v4', 'benqi', 'euler-v2', 'silo-v2', 'silo-v3']);
});

test('lending source contract gates optional factory vault UI and exposes liquidation evidence lanes', () => {
  assert.match(appSource, /hasVaultInventory = vaultAvailability !== 'unavailable'/);
  assert.match(appSource, /\{hasVaultInventory && <Kpi label="Factory Vault Assets"/);
  assert.match(appSource, /\{hasVaultInventory && <>[\s\S]*Active Factory Vault Ledger/);
  assert.match(appSource, /Daily Liquidation Events/);
  assert.match(appSource, /Liquidation Protocol Ledger/);
  assert.match(appSource, /aria-label=\{`Methodology for \$\{title\}`\}/);
  assert.match(appSource, /aria-label="Lending protocol filter"/);
  assert.match(appSource, /aria-label="Lending asset filter"/);
  assert.ok(sources.sources.some((source) => source.id === 'defillama-coins'));
  assert.ok(sources.sources.some((source) => source.id === 'euler-protocol-native'));
  assert.ok(sources.sources.some((source) => source.id === 'silo-protocol-native'));
  assert.ok(registry.protocols.some((protocol) => protocol.id === 'aave-v4'));
  assert.ok(registry.protocols.some((protocol) => protocol.id === 'euler-v2'));
  assert.ok(registry.protocols.some((protocol) => protocol.id === 'silo-v2'));
  assert.equal(catalog.metrics.find((metric) => metric.id === 'lending_vault_tvl').label, 'Factory Vault Assets');
  assert.deepEqual(catalog.metrics.find((metric) => metric.id === 'lending_rates').sources.slice(0, 2), ['euler-protocol-native', 'silo-protocol-native']);
  assert.match(catalog.metrics.find((metric) => metric.id === 'lending_liquidations').definition, /Aave V3\/V4.*BENQI.*Euler.*Silo/i);
  assert.equal(lendingConfig.protocols['euler-v2'].utilsLens.toLowerCase(), '0xff241d57fb342aea9bc6de386852272c516063ee');
  assert.equal(lendingConfig.protocols['silo-v2'].factoryStartId, 3001);
  assert.equal(lendingConfig.protocols['silo-v2'].marketConfigs.length, 42);
  assert.equal(new Set(lendingConfig.protocols['silo-v2'].marketConfigs.map((row) => row.address.toLowerCase())).size, 42);
});

test('protocol-native lending rows preserve source, basis, coverage, and impaired states', () => {
  const eulerRows = dashboard.lending.markets.filter((row) => row.protocol === 'euler-v2');
  const siloRows = [...dashboard.lending.markets, ...dashboard.lending.impairedMarkets].filter((row) => row.protocol === 'silo-v2');
  assert.ok(eulerRows.length > 0);
  assert.ok(siloRows.length > 0);
  assert.ok(eulerRows.every((row) => row.rateBasis === 'APY' && row.sourceUrl));
  assert.ok(siloRows.every((row) => row.rateBasis === 'APR' && row.sourceUrl));
  assert.ok([...eulerRows, ...siloRows].every((row) => [row.supplyRatePct, row.borrowRatePct].every(value => value == null || Number.isFinite(value))));
  assert.ok(dashboard.lending.impairedMarkets.every((row) => ['impaired', 'legacy'].includes(row.status)));
  const siloCoverage = dashboard.lending.marketCoverage.find((row) => row.protocol === 'silo-v2');
  assert.ok(siloCoverage.discoveredConfigs >= 65);
  assert.ok(siloCoverage.queried <= siloCoverage.discovered);
  assert.ok(Array.isArray(siloCoverage.failedConfigs));
});

test('economics page replaces unsupported cards with the official live supply ledger', () => {
  assert.match(appSource, /Current AVAX Supply/);
  assert.match(appSource, /Net Supply Since Genesis/);
  assert.match(appSource, /Staking Rewards Minted/);
  assert.match(appSource, /Network Fees Burned/);
  assert.match(appSource, /Primary Network Supply Ledger/);
  assert.doesNotMatch(appSource, /label="Issued AVAX"|label="Validator Fee Revenue"|label="Gross Margin"/);
  assert.ok(sources.sources.some((source) => source.id === 'avalanche-data-api'));
  for (const metricId of ['avax_supply_ledger', 'avax_staking_rewards', 'avax_network_fee_burn']) {
    assert.ok(catalog.metrics.some((metric) => metric.id === metricId));
  }
});

test('AVAX unlock calendar trusts DefiLlama with explicit third-party provenance', () => {
  assert.match(appSource, /avax-foundation-2026-10-24/);
  assert.match(appSource, /1_670_000/);
  assert.match(appSource, /https:\/\/defillama\.com\/unlocks\/avalanche/);
  assert.match(appSource, /DefiLlama tracked/);
  assert.match(appSource, /USD value is intentionally calculated nowhere/);
});

test('stablecoins and tokenized funds are represented in separate classifications', () => {
  const stableSymbols = new Set(dashboard.overview.stablecoins.assets.map((asset) => asset.symbol.toUpperCase()));
  const rwaSymbols = new Set(dashboard.tokenizedAssets.assets.map((asset) => asset.symbol.toUpperCase()));
  const valuedAssets = dashboard.tokenizedAssets.assets.filter((asset) => Number.isFinite(asset.valueUsd));
  const verifiedContractValue = valuedAssets.length ? valuedAssets.reduce((total, asset) => total + asset.valueUsd, 0) : null;
  const broaderRwaAdapterTvl = dashboard.tokenizedAssets.protocols.reduce((total, protocol) => total + protocol.tvl, 0);
  assert.ok(rwaSymbols.has('BUIDL'));
  assert.ok(!stableSymbols.has('BUIDL'));
  assert.ok(dashboard.overview.kpis.stablecoinMarketCapUsd >= 0);
  assert.ok(verifiedContractValue == null
    ? dashboard.tokenizedAssets.kpis.verifiedContractValueUsd == null
    : Math.abs(dashboard.tokenizedAssets.kpis.verifiedContractValueUsd - verifiedContractValue) < 0.01);
  assert.equal(dashboard.tokenizedAssets.kpis.trackedValueUsd, dashboard.tokenizedAssets.kpis.verifiedContractValueUsd);
  assert.ok(Math.abs(dashboard.tokenizedAssets.kpis.rwaAdapterTvlUsd - broaderRwaAdapterTvl) < 0.01);
  assert.ok(dashboard.tokenizedAssets.kpis.verifiedContractValueUsd == null
    || dashboard.tokenizedAssets.kpis.rwaAdapterTvlUsd > dashboard.tokenizedAssets.kpis.verifiedContractValueUsd);
  assert.equal(dashboard.overview.kpis.tokenizedAssetValueUsd, dashboard.tokenizedAssets.kpis.verifiedContractValueUsd);
  assert.equal(dashboard.overview.kpis.rwaAdapterTvlUsd, dashboard.tokenizedAssets.kpis.rwaAdapterTvlUsd);
});

test('protocol-type TVL is explicitly non-additive', () => {
  const protocolTvl = dashboard.overview.protocolTvl;
  assert.equal(protocolTvl.byTypeAccounting.additive, false);
  assert.equal(protocolTvl.byTypeAccounting.chainTvlUsd, dashboard.overview.kpis.protocolTvlUsd);
  assert.ok(Math.abs(protocolTvl.byTypeAccounting.grossAdapterTvlUsd - protocolTvl.byType.reduce((total, row) => total + row.value, 0)) < 0.01);
  assert.match(protocolTvl.byTypeAccounting.explanation, /must not be summed/i);

});

test('source freshness is explicit and every observed source is healthy', () => {
  assert.ok(['healthy', 'degraded'].includes(dashboard.metadata.freshness));
  assert.ok(dashboard.metadata.latestCompleteDate);
  assert.equal(dashboard.metadata.partialDay, true);
  assert.ok(dashboard.quality.sourceHealth.length >= 6);
  assert.ok(dashboard.quality.sourceHealth.some((source) => source.ok));
  assert.equal(
    dashboard.metadata.freshness === 'healthy',
    dashboard.quality.sourceHealth.filter((source) => source.required !== false).every((source) => source.ok),
  );
});

test('cross-source verification is scope-aware, source-linked, and non-mutating', () => {
  const verification = dashboard.quality.verification;
  const sourceIds = new Set(sources.sources.map((source) => source.id));
  assert.equal(verification.schema, 'couchdicks.avalanche.verification.v1');
  assert.ok(verification.checks.length >= 15);
  assert.equal(new Set(verification.checks.map((check) => check.id)).size, verification.checks.length);
  assert.equal(verification.summary.total, verification.checks.length);
  assert.equal(verification.summary.review, verification.checks.filter((check) => check.status === 'review').length);
  assert.equal(verification.summary.pass, verification.checks.filter((check) => check.status === 'pass').length);
  assert.ok(verification.summary.pass >= 0);
  assert.equal(verification.summary.pass + verification.summary.review, verification.summary.scored);
  assert.ok(verification.summary.context >= 0);
  assert.ok(verification.summary.unavailable >= 1);

  for (const check of verification.checks) {
    assert.ok(sourceIds.has(check.comparator.sourceId), `${check.id} has an unknown source`);
    assert.ok(check.unit);
    assert.ok(check.scope);
    assert.ok(check.comparator.url);
    assert.ok(['pass', 'review', 'context', 'unavailable'].includes(check.status));
    if (check.status === 'context') {
      assert.equal(check.tolerancePct, null);
      assert.equal(check.comparability, 'context');
    }
  }

  const rwaChecks = verification.checks.filter((check) => check.id.startsWith('rwa-'));
  assert.ok(rwaChecks.length >= 9);
  assert.ok(rwaChecks.every((check) => check.comparator.url.includes('rwa.xyz')));
  assert.equal(verification.checks.find((check) => check.id === 'rwa-secz-value').status, 'unavailable');
  assert.equal(dashboard.tokenizedAssets.assets.find((asset) => asset.id === 'secz').valueUsd, null);
  assert.equal(dashboard.overview.kpis.tokenizedAssetValueUsd, dashboard.tokenizedAssets.kpis.verifiedContractValueUsd);
});

test('semantic cleanup invariants reconcile scopes without fake values', () => {
  const lending = dashboard.lending;
  assert.ok(lending.impairedMarkets.length > 0);
  assert.ok(lending.impairedMarkets.every(row => row.includedInHeadline === false));
  assert.ok(lending.markets.every((row) => row.riskState !== 'impaired'));
  const eligible = lending.markets.filter(row => row.includedInHeadline !== false && row.eligible !== false && row.visibility !== 'hidden');
  for (const [kpi, field] of [['totalSuppliedUsd','suppliedUsd'],['availableLiquidityUsd','availableLiquidityUsd']]) {
    const total = eligible.reduce((sum,row) => sum + (row[field] ?? 0),0);
    assert.ok(Math.abs(total-lending.kpis[kpi]) <= Math.max(1e-8,total*1e-12));
  }
  assert.doesNotMatch(appSource, /suppliedUsd\s*\?\?\s*row\.tvlUsd/);

  const stable = dashboard.overview.stablecoins.composition;
  assert.ok(Math.abs(stable.topTenSubtotalUsd + stable.otherUsd - stable.headlineTotalUsd) <= stable.roundingToleranceUsd);
  assert.equal(stable.headlineTotalUsd, dashboard.overview.kpis.stablecoinMarketCapUsd);

  const dex = dashboard.overview.ammLiquidity;
  const visible = dex.protocols.reduce((total, row) => total + row.tvl, 0);
  assert.ok(Math.abs(visible + dex.omittedTvlUsd - dex.valueUsd) < 0.01);
  assert.equal(dex.visibleAdapterCount + dex.omittedAdapterCount, dex.positiveAdapterCount);

  assert.equal(dashboard.tokenizedAssets.kpis.valuedAssets, dashboard.tokenizedAssets.assets.filter((row) => row.valueUsd != null).length);
  assert.equal(dashboard.tokenizedAssets.kpis.trackedAssets, dashboard.tokenizedAssets.assets.length);
  assert.ok(dashboard.overview.bridges.protocols.every((row) => row.operationalStatus === 'unknown'));
  assert.ok(dashboard.overview.bridges.protocols.every((row) => row.operationalStatusSourceUrl === null && row.operationalStatusCheckedAt === null));
  assert.equal(dashboard.quality.verification.summary.pass, dashboard.quality.verification.checks.filter((check) => check.status === 'pass').length);
});

test('thirty-day annualized burn is the displayed thirty-day daily average times 365', () => {
  const fees = dashboard.economics.feeHistory;
  const annualized = dashboard.economics.annualizedHistory;
  for (let index = 0; index < annualized.length; index += 1) {
    const window = fees.slice(Math.max(0, index - 29), index + 1).map((row) => row.feesAvax).filter(Number.isFinite);
    const expected = window.reduce((total, value) => total + value, 0) / window.length * 365;
    assert.ok(Math.abs(annualized[index].avax30d - expected) < 1e-12);
  }
});

test('DEX completed-day headline is separated from current partial-day architecture', () => {
  for (const scope of [dashboard.overview.dex, dashboard.spot]) {
    assert.ok(['current-utc-day-partial', 'latest-available-utc-day'].includes(scope.architectureCoverage.window));
    if (scope.architectureCoverage.date == null) {
      assert.equal(scope.architectureCoverage.totalVolumeUsd, null);
      assert.deepEqual(scope.architectureComposition, []);
      continue;
    }
    const architectureDay = Date.parse(`${scope.architectureCoverage.date}T00:00:00Z`);
    const generatedDay = Date.parse(`${dashboard.generatedAt.slice(0, 10)}T00:00:00Z`);
    assert.ok(architectureDay <= generatedDay);
    assert.ok(generatedDay - architectureDay <= 86_400_000);
    assert.ok(Math.abs(
      scope.architectureComposition.reduce((total, row) => total + row.value, 0)
      - scope.architectureCoverage.totalVolumeUsd
    ) < 0.01);
  }
  assert.equal(dashboard.spot.volume24hLabel, 'Latest complete UTC day');
  if (dashboard.spot.architectureCoverage.window === 'current-utc-day-partial') {
    assert.notEqual(dashboard.spot.volume24hUsd, dashboard.spot.architectureCoverage.totalVolumeUsd);
  }
});

test('DEX history exposes one combined Pharaoh liquidity source', () => {
  for (const scope of [dashboard.overview.dex, dashboard.spot]) {
    if (scope.breakdownHistory.length) assert.ok(scope.breakdownHistory.some((row) => row.Pharaoh > 0));
    for (const row of scope.breakdownHistory) {
      const pharaohKeys = Object.keys(row).filter((key) => /^pharaoh(?:\s|$)/i.test(key));
      assert.deepEqual(pharaohKeys, row.Pharaoh == null ? [] : ['Pharaoh']);
    }
  }
  assert.match(appSource, /Pharaoh adapters are combined/);
});

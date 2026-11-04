import { publishSnapshotBundle } from './snapshot-bundle.mjs';
import { updateDashboardTokenized } from './tokenized-publisher.mjs';
import { runBoundedChildrenSettled } from './bounded-child.mjs';
import { closeSync, mkdirSync, openSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  fetchJson,
  fetchText,
  latestValue,
  readJson,
  rpc,
  safeNumber,
  sourceState,
  sum,
  unixDate,
  writeJsonAtomic,
} from './lib.mjs';
import {
  buildVerificationCheck,
  parseRwaAssetPage,
  summarizeVerification,
} from './verification.mjs';
import { updateDashboardLending, LENDING_REFERENCE_SLUGS, canonicalLendingSourceHealth } from './lending-dashboard.mjs';
import { combineDexLiquiditySources } from '../src/dex-breakdown.mjs';
import {
  AVALANCHE_LENDING_SCOPE,
  buildAvalancheProtocolLiquidity,
  partitionLendingMarkets,
  validateLendingMarketRow,
} from './lending-metrics.mjs';
import { activityFreshness, composeTokenizedEvidence, fieldFromSourceEnvelope, independentObservedField, summarizeTokenized, tokenizedStockVenueLandscape } from './tokenized-dashboard.mjs';

const RPC_URL = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const TOKENIZED_GATEWAY_URL = process.env.TOKENIZED_GATEWAY_URL || 'http://127.0.0.1:43140/api/materialized/avalanche/tokenized-assets';
const STATE_OUTPUT = path.join(ROOT, 'state', 'dashboard.json');
const CHECKPOINT = path.join(ROOT, 'state', 'checkpoint.json');
const HOLDER_HISTORY = path.join(ROOT, 'state', 'holder-history.json');
const LENDING_METRICS_STATE = path.join(ROOT, 'state', 'lending-metrics.json');
const registry = await readJson(path.join(ROOT, 'config', 'protocol-registry.json'), {});
const metricCatalog = await readJson(path.join(ROOT, 'config', 'metric-catalog.json'), {});
const sourceCatalog = await readJson(path.join(ROOT, 'config', 'sources.json'), {});
const lockDirectory = path.join(ROOT, 'state', 'locks');
const lockFile = path.join(lockDirectory, 'collect.lock');

mkdirSync(lockDirectory, { recursive: true });
try {
  if (Date.now() - statSync(lockFile).mtimeMs > 60 * 60 * 1000) unlinkSync(lockFile);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

let lockDescriptor;
try {
  lockDescriptor = openSync(lockFile, 'wx');
  writeFileSync(lockDescriptor, `${process.pid}\n`);
  closeSync(lockDescriptor);
} catch (error) {
  if (error.code === 'EEXIST') throw new Error(`collector already active (${lockFile})`);
  throw error;
}

const releaseLock = () => {
  try {
    unlinkSync(lockFile);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`could not remove collector lock: ${error.message}`);
  }
};
process.on('exit', releaseLock);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const urls = {
  chains: 'https://api.llama.fi/v2/chains',
  protocols: 'https://api.llama.fi/protocols',
  chainTvl: 'https://api.llama.fi/v2/historicalChainTvl/Avalanche',
  dex: 'https://api.llama.fi/overview/dexs/Avalanche?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=false&dataType=dailyVolume',
  fees: 'https://api.llama.fi/overview/fees/Avalanche?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true&dataType=dailyFees',
  stablecoins: 'https://stablecoins.llama.fi/stablecoins?includePrices=true',
  yields: 'https://yields.llama.fi/pools',
  avaxPrice: 'https://api.coingecko.com/api/v3/simple/price?ids=avalanche-2&vs_currencies=usd&include_market_cap=true&include_24hr_change=true',
  avaxFallback: 'https://api.coinpaprika.com/v1/tickers/avax-avalanche',
  routescan: 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api',
  avalancheMetrics: 'https://metrics.avax.network/v2/chains/43114/metrics',
};
const rwaAssetPages = [
  {
    assetId: 'buidl',
    ticker: 'BUIDL',
    address: '0x53fc82f14f009009b440a706e31c9021e1196a2f',
    url: 'https://app.rwa.xyz/assets/BUIDL',
  },
  {
    assetId: 'vbill',
    ticker: 'VBILL',
    address: '0x7f4546ef315efc65336187fe3765ea779ac90183',
    url: 'https://app.rwa.xyz/assets/VBILL',
  },
  {
    assetId: 'acred',
    ticker: 'ACRED',
    address: '0x7c64925002bfa705834b118a923e9911bee32875',
    url: 'https://app.rwa.xyz/assets/ACRED',
  },
  {
    assetId: 'secz',
    ticker: 'SECZ',
    address: '0x5954ff4099ac47c4d6d098a9216f3278bb8c9506',
    url: 'https://app.rwa.xyz/assets/SECZ',
  },
];

const derivedResults = await runBoundedChildrenSettled([
  { name: 'blockspace', file: path.join(ROOT, 'scripts', 'collect-blockspace.mjs'), options: { cwd: ROOT, env: process.env, timeoutMs: Math.max(30_000, Number(process.env.BLOCKSPACE_COLLECT_TIMEOUT_MS || 300_000)) } },
  { name: 'tokenized-activity', file: path.join(ROOT, 'scripts', 'collect-tokenized.mjs'), options: { cwd: ROOT, env: process.env, timeoutMs: Math.max(30_000, Number(process.env.TOKENIZED_COLLECT_TIMEOUT_MS || 300_000)) } },
  { name: 'lending', file: path.join(ROOT, 'scripts', 'collect-lending.mjs'), options: { cwd: ROOT, env: process.env, timeoutMs: Math.max(30_000, Number(process.env.LENDING_COLLECT_TIMEOUT_MS || 300_000)) } },
]);
for (const result of derivedResults) {
  if (result.status === 'rejected') console.error(`${result.name} refresh failed; retaining its last-good snapshot: ${result.reason?.message || result.reason}`);
  else if (result.value.stderr) console.error(result.value.stderr.trim());
}

const rwaPagePromise = Promise.all(rwaAssetPages.map(async (asset) => ({
  asset,
  result: await fetchText(asset.url, { retries: 1 }),
})));
const [
  chainsResult,
  protocolsResult,
  chainTvlResult,
  dexResult,
  feesResult,
  stablecoinsResult,
  yieldsResult,
  avaxPriceResult,
  avaxFallbackResult,
  blockResult,
  gasPriceResult,
] = await Promise.all([
  fetchJson(urls.chains),
  fetchJson(urls.protocols),
  fetchJson(urls.chainTvl),
  fetchJson(urls.dex),
  fetchJson(urls.fees),
  fetchJson(urls.stablecoins),
  fetchJson(urls.yields),
  fetchJson(urls.avaxPrice, { retries: 0 }),
  fetchJson(urls.avaxFallback),
  rpc(RPC_URL, 'eth_getBlockByNumber', ['latest', false]),
  rpc(RPC_URL, 'eth_gasPrice'),
]);
const rwaPageResults = await rwaPagePromise;

const blockspace = await readJson(path.join(ROOT, 'state', 'blockspace.json'), {});
const tokenActivity = await readJson(path.join(ROOT, 'state', 'tokenized-activity.json'), {});
const lendingMetrics = await readJson(LENDING_METRICS_STATE, {});
const previousDashboard = await readJson(STATE_OUTPUT, {});
const verificationDate = blockspace.coverage?.end || null;
const verificationTimestamp = verificationDate ? Math.floor(Date.parse(`${verificationDate}T00:00:00Z`) / 1000) : null;
const avalancheMetricNames = ['txCount', 'avgGasPrice', 'feesPaid', 'activeSenders', 'contracts'];
const avalancheMetricResults = Object.fromEntries(await Promise.all(avalancheMetricNames.map(async (metric) => {
  if (verificationTimestamp == null) return [metric, { ok: false, data: null, error: 'latest complete date unavailable' }];
  const query = new URL(`${urls.avalancheMetrics}/${metric}`);
  query.searchParams.set('startTimestamp', String(verificationTimestamp));
  query.searchParams.set('endTimestamp', String(verificationTimestamp + 86_400));
  query.searchParams.set('timeInterval', 'day');
  query.searchParams.set('pageSize', '2');
  return [metric, await fetchJson(query.toString(), { retries: 1 })];
})));
function avalancheMetricValue(metric) {
  const result = avalancheMetricResults[metric];
  const row = result?.data?.results?.find((point) => safeNumber(point.timestamp) === verificationTimestamp);
  return safeNumber(row?.value);
}
const protocols = Array.isArray(protocolsResult.data) ? protocolsResult.data : [];
const avalancheProtocols = protocols.filter((protocol) => protocol.chains?.includes('Avalanche'));
const protocolRows = avalancheProtocols
  .map((protocol) => ({
    name: protocol.name,
    slug: protocol.slug,
    category: protocol.category || 'Other',
    tvl: safeNumber(protocol.chainTvls?.Avalanche),
    borrowed: safeNumber(protocol.chainTvls?.['Avalanche-borrowed']),
    url: protocol.url && !/arbitrum|robinhood/i.test(protocol.url) ? protocol.url : null,
    logo: protocol.logo || null,
  }))
  .filter((protocol) => protocol.tvl != null);

const excludedProtocolCategories = new Set(['CEX', 'Chain']);
const materialProtocols = protocolRows
  .filter((protocol) => !excludedProtocolCategories.has(protocol.category) && protocol.category !== 'Bridge')
  .sort((a, b) => b.tvl - a.tvl);
const topProtocolSlugs = materialProtocols.slice(0, 12).map((protocol) => protocol.slug);
const lendingSlugs = [...LENDING_REFERENCE_SLUGS];
const rwaSlugs = protocolRows
  .filter((protocol) => protocol.category === 'RWA' && protocol.tvl > 0)
  .sort((a, b) => b.tvl - a.tvl)
  .slice(0, 14)
  .map((protocol) => protocol.slug);
const detailSlugs = [...new Set([...topProtocolSlugs, ...lendingSlugs, ...rwaSlugs])];
const detailResults = await Promise.all(detailSlugs.map(async (slug) => [slug, await fetchJson(`https://api.llama.fi/protocol/${slug}`)]));
const details = new Map(detailResults.filter(([, result]) => result.ok).map(([slug, result]) => [slug, result.data]));

function chainSeries(detail, key = 'Avalanche', limit = 730) {
  return (detail?.chainTvls?.[key]?.tvl || []).slice(-limit).map((point) => ({
    date: unixDate(point.date),
    value: safeNumber(point.totalLiquidityUSD),
  })).filter((point) => point.date && point.value != null);
}

function mergeSeries(seriesRows, fieldFor) {
  const dates = new Map();
  for (const [key, series] of seriesRows) {
    for (const point of series) {
      const row = dates.get(point.date) || { date: point.date };
      row[fieldFor(key)] = point.value;
      dates.set(point.date, row);
    }
  }
  return [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const protocolSeries = mergeSeries(
  topProtocolSlugs.map((slug) => [slug, chainSeries(details.get(slug), 'Avalanche', 365)]),
  (slug) => slug,
);
const protocolTypes = Object.entries(materialProtocols.reduce((acc, protocol) => {
  acc[protocol.category] = (acc[protocol.category] || 0) + protocol.tvl;
  return acc;
}, {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

const rwaProtocols = protocolRows.filter((protocol) => protocol.category === 'RWA' && protocol.tvl > 0)
  .map((protocol) => ({ ...protocol, protocolUrl: protocol.url, sourceUrl: `https://api.llama.fi/protocol/${encodeURIComponent(protocol.slug)}`, sourceLabel: 'DeFiLlama protocol adapter' }))
  .sort((a, b) => b.tvl - a.tvl);
const rwaHistory = mergeSeries(
  rwaSlugs.map((slug) => [slug, chainSeries(details.get(slug), 'Avalanche', 365)]),
  (slug) => slug,
).map((row) => ({
  ...row,
  total: sum(Object.entries(row).filter(([key]) => key !== 'date').map(([, value]) => value)),
}));

const stableAssets = (stablecoinsResult.data?.peggedAssets || [])
  .map((asset) => ({
    id: String(asset.id),
    name: asset.name,
    symbol: asset.symbol,
    price: safeNumber(asset.price),
    pegMechanism: asset.pegMechanism || null,
    geckoId: asset.gecko_id || null,
    current: safeNumber(asset.chainCirculating?.Avalanche?.current?.peggedUSD),
  }))
  .filter((asset) => asset.current > 0 && asset.symbol !== 'BUIDL')
  .sort((a, b) => b.current - a.current);
const stableHistoryResults = await Promise.all(stableAssets.slice(0, 12).map(async (asset) => [
  asset,
  await fetchJson(`https://stablecoins.llama.fi/stablecoincharts/Avalanche?stablecoin=${encodeURIComponent(asset.id)}`),
]));
const stableSeriesByAsset = stableHistoryResults
  .filter(([, result]) => result.ok)
  .map(([asset, result]) => [asset.symbol, result.data.slice(-730).map((point) => ({
    date: unixDate(point.date),
    value: safeNumber(point.totalCirculatingUSD?.peggedUSD),
  })).filter((point) => point.date && point.value != null)]);
const stableHistory = mergeSeries(stableSeriesByAsset, (symbol) => symbol).map((row) => ({
  ...row,
  total: sum(Object.entries(row).filter(([key]) => key !== 'date').map(([, value]) => value)),
}));
const stablecoinMarketCap = sum(stableAssets.map((asset) => asset.current));
const stablecoinTopTenUsd = sum(stableAssets.slice(0, 10).map((asset) => asset.current));
const stablecoinOtherUsd = Math.max(0, stablecoinMarketCap - stablecoinTopTenUsd);
const stablecoinTopTenCoveragePct = stablecoinMarketCap > 0 ? stablecoinTopTenUsd / stablecoinMarketCap * 100 : null;

const rawDexBreakdown = (dexResult.data?.totalDataChartBreakdown || []).slice(-730).map(([timestamp, values]) => ({
  date: unixDate(timestamp),
  ...(values || {}),
}));
const dexBreakdown = combineDexLiquiditySources(rawDexBreakdown);
const dexTotal = (dexResult.data?.totalDataChart || []).slice(-730).map(([timestamp, value]) => ({
  date: unixDate(timestamp),
  total: safeNumber(value),
}));
const dexProtocolRows = (dexResult.data?.protocols || [])
  .map((protocol) => ({
    name: protocol.displayName || protocol.name,
    volume24h: safeNumber(protocol.total24h),
    volume7d: safeNumber(protocol.total7d),
    volume30d: safeNumber(protocol.total30d),
    change1d: safeNumber(protocol.change_1d),
    change7d: safeNumber(protocol.change_7d),
  }));
const dexProtocols = dexProtocolRows
  .filter((protocol) => protocol.volume30d > 0)
  .sort((a, b) => b.volume30d - a.volume30d);

function dexArchitecture(name) {
  const value = name.toLowerCase();
  if (value.includes('dlmm') || value.includes('joe v2.1') || value.includes('joe v2.2')) return 'Bin-based / DLMM';
  if (value.includes('blackhole cl') || value.includes('algebra')) return 'Algebra CL';
  if (value.includes(' v3') || value.includes(' v4') || value.includes('clmm') || value.includes(' cl')) return 'Concentrated liquidity';
  if (/(curve|platypus|wombat|axial)/.test(value)) return 'Stable-swap';
  if (value.includes('balancer')) return 'Weighted pools';
  if (value.includes('gmx')) return 'Oracle-priced spot';
  return 'Constant-product / other';
}

const latestCompleteDexVolumeUsd = safeNumber(dexResult.data?.total24h);
const currentDexDay = dexTotal.at(-1) || {};
const currentUtcDate = new Date().toISOString().slice(0, 10);
const architectureWindow = currentDexDay.date === currentUtcDate
  ? 'current-utc-day-partial'
  : 'latest-available-utc-day';
const currentDexDayVolumeUsd = safeNumber(currentDexDay.total);
const currentDexBreakdown = rawDexBreakdown.at(-1) || {};
const architectureComposition = Object.entries(currentDexBreakdown)
  .filter(([name, value]) => name !== 'date' && safeNumber(value) > 0)
  .reduce((acc, [name, value]) => {
    const architecture = dexArchitecture(name);
    acc[architecture] = (acc[architecture] || 0) + safeNumber(value);
    return acc;
  }, {});
const classifiedArchitectureVolume24h = sum(Object.values(architectureComposition));
const architectureTimingGap24h = currentDexDayVolumeUsd == null
  ? null
  : Math.max(0, currentDexDayVolumeUsd - classifiedArchitectureVolume24h);
if (architectureTimingGap24h > 0) {
  architectureComposition['Unclassified / adapter lag'] = architectureTimingGap24h;
}

const bridgeProtocols = protocolRows
  .filter((protocol) => protocol.category === 'Bridge' && protocol.tvl > 0)
  .map((protocol) => ({
    ...protocol,
    operationalStatus: 'unknown',
    operationalStatusSourceUrl: null,
    operationalStatusCheckedAt: null,
    operationalStatusMethod: 'manual review required; adapter TVL is never status evidence',
  }))
  .sort((a, b) => b.tvl - a.tvl);
const lendingDetails = lendingSlugs.map((slug) => {
  const detail = details.get(slug);
  const protocol = protocolRows.find((row) => row.slug === slug);
  return buildAvalancheProtocolLiquidity({ slug, detail, protocol });
});
const lendingHistoryBySlug = lendingSlugs.map((slug) => {
  const detail = details.get(slug);
  const netTvl = new Map(chainSeries(detail, 'Avalanche', 730).map((point) => [point.date, point.value]));
  const borrowed = new Map(chainSeries(detail, 'Avalanche-borrowed', 730).map((point) => [point.date, point.value]));
  const dates = [...new Set([...netTvl.keys(), ...borrowed.keys()])].sort();
  return [slug, dates.map((date) => ({
    date,
    ...AVALANCHE_LENDING_SCOPE,
    netTvl: netTvl.get(date) ?? null,
    supplied: null,
    borrowed: borrowed.get(date) ?? null,
    availableLiquidity: null,
  }))];
});
const lendingDates = new Map();
for (const [slug, series] of lendingHistoryBySlug) {
  for (const point of series) {
    const row = lendingDates.get(point.date) || { date: point.date, ...AVALANCHE_LENDING_SCOPE, netTvl: 0, borrowed: 0, supplied: null, availableLiquidity: null, protocols: {} };
    row.protocols[slug] = point;
    for (const key of ['netTvl', 'borrowed']) {
      if (point[key] != null) row[key] += point[key];
    }
    lendingDates.set(point.date, row);
  }
}
const lendingHistory = [...lendingDates.values()].sort((a, b) => a.date.localeCompare(b.date));
const lendingProjectIds = new Set(LENDING_REFERENCE_SLUGS);
const adapterLendingPools = (yieldsResult.data?.data || [])
  .filter((pool) => pool.chain === 'Avalanche' && lendingProjectIds.has(pool.project))
  .map((pool) => ({
    id: pool.pool,
    protocol: pool.project,
    ...AVALANCHE_LENDING_SCOPE,
    symbol: pool.symbol,
    marketName: pool.symbol,
    tvlUsd: safeNumber(pool.tvlUsd),
    supplyApy: safeNumber(pool.apyBase),
    incentiveApy: safeNumber(pool.apyReward),
    totalApy: safeNumber(pool.apy),
    stablecoin: Boolean(pool.stablecoin),
    underlyingTokens: pool.underlyingTokens || [],
    borrowApy: null,
    supplyRatePct: safeNumber(pool.apyBase),
    borrowRatePct: null,
    rateBasis: 'APY',
    suppliedUsd: null,
    borrowedUsd: null,
    netTvlUsd: safeNumber(pool.tvlUsd),
    availableLiquidityUsd: null,
    utilizationPct: null,
    utilizationDerived: false,
    utilizationFormula: null,
    fieldProvenance: {
      supplied: { sourceField: null, accounting: 'gross supplied assets not exposed by DeFiLlama Yields', derived: false },
      borrowed: { sourceField: null, accounting: 'gross borrowed assets not exposed by DeFiLlama Yields', derived: false },
      netTvl: { sourceField: 'tvlUsd', accounting: 'adapter TVL proxy', derived: false },
      availableLiquidity: { sourceField: null, accounting: 'immediately available underlying not exposed', derived: false },
    },
    state: 'available',
    rateSource: 'DefiLlama Yields adapter',
    observedAt: yieldsResult.fetchedAt || null,
  }))
  .sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0));
const hasCanonicalLending = lendingMetrics.schema === 'couchdicks.avalanche.lending-metrics.v4'
  && (lendingMetrics.markets?.rows || []).length > 0;
const nativeRateProtocols = new Set(hasCanonicalLending
  ? ['aave-v3', 'aave-v4', 'benqi', 'benqi-lending', 'euler-v2', 'silo-v2', 'silo-v3']
  : ['euler-v2', 'silo-v2']);
const allLendingPools = [
  // A complete accepted canonical snapshot owns all six named families. Never
  // blend same-market DeFiLlama yield rows into that accounting universe.
  ...adapterLendingPools.filter((row) => !nativeRateProtocols.has(row.protocol)),
  ...(lendingMetrics.markets?.rows || []),
];
const lendingValidationIssues = allLendingPools.flatMap((row) => validateLendingMarketRow(row).issues.map((issue) => ({ id: row.id, issue })));
if (lendingValidationIssues.length) throw new Error(`invalid lending accounting: ${JSON.stringify(lendingValidationIssues)}`);
const lendingMarketPartitions = partitionLendingMarkets(allLendingPools);

const tokenProtocols = (registry.protocols || []).filter((protocol) => protocol.contracts?.some((contract) => contract.role === 'Token'));
const canonicalTokenizedResult = await fetchJson(TOKENIZED_GATEWAY_URL, { timeoutMs: 15_000, retries: 1 });
const canonicalTokenized = canonicalTokenizedResult.ok
  && canonicalTokenizedResult.data?.schemaVersion === 'avalanche-gateway-tokenized-assets/v2'
  && canonicalTokenizedResult.data?.registryVersion === 'avalanche-tokenized-assets-registry/2026-09-18'
  ? canonicalTokenizedResult.data : null;
const canonicalById = new Map((canonicalTokenized?.assets || []).map((row) => [row.id, row]));
const previousAssets = new Map((previousDashboard.tokenizedAssets?.assets || []).map((row) => [row.id, row]));
const tokenRows = (await Promise.all(tokenProtocols.map(async (protocol) => {
  const contract = protocol.contracts.find((row) => row.role === 'Token');
  const canonical = canonicalById.get(protocol.id);
  const holderCount = await fetchJson(`${urls.routescan}?module=token&action=tokenholdercount&contractaddress=${contract.address}`);
  const holderBody = holderCount.data;
  const previous = previousAssets.get(protocol.id);
  const gatewayError = canonicalTokenizedResult.error || 'canonical Gateway unavailable';
  const totalSupply = fieldFromSourceEnvelope(canonical?.token?.totalSupply, { previousValue: previous?.totalSupply, previousStatus: previous?.fieldStatus?.totalSupply, sourceError: gatewayError });
  const symbol = fieldFromSourceEnvelope(canonical?.token?.symbol, { previousValue: previous?.symbol, previousStatus: previous?.fieldStatus?.symbol, fallbackValue: protocol.id.toUpperCase(), sourceError: gatewayError });
  const tokenName = fieldFromSourceEnvelope(canonical?.token?.tokenName, { previousValue: previous?.tokenName, previousStatus: previous?.fieldStatus?.tokenName, fallbackValue: protocol.name, sourceError: gatewayError });
  const valueUsd = fieldFromSourceEnvelope(canonical?.valueUsd, { previousValue: previous?.valueUsd, previousStatus: previous?.fieldStatus?.valueUsd, sourceError: gatewayError });
  const valuationUsd = fieldFromSourceEnvelope(canonical?.valuation, { previousValue: previous?.valuationUsd, previousStatus: previous?.fieldStatus?.valuationUsd, sourceError: gatewayError });
  const holderOk = holderCount.ok && holderBody?.status === '1';
  const holders = independentObservedField({ ok: holderOk, value: holderOk ? safeNumber(holderBody.result) : null, fetchedAt: holderCount.fetchedAt, error: holderCount.error || holderBody?.message || 'holder count unavailable', previousValue: previous?.holders, previousStatus: previous?.fieldStatus?.holders });
  return {
    id: protocol.id, name: protocol.name, category: protocol.category, address: contract.address,
    implementation: contract.implementation || null,
    decimals: canonical?.token?.decimals?.value ?? previous?.decimals ?? null,
    totalSupply: totalSupply.value,
    totalSupplyRaw: canonical?.token?.totalSupplyRaw?.value ?? previous?.totalSupplyRaw ?? null,
    totalSupplyExact: canonical?.token?.totalSupplyExact?.value ?? previous?.totalSupplyExact ?? null,
    holders: holders.value,
    symbol: symbol.value,
    tokenName: tokenName.value,
    valueUsd: valueUsd.value,
    valueUsdExact: canonical?.valueUsd?.valueExact ?? previous?.valueUsdExact ?? null,
    valuationUsd: valuationUsd.value,
    valuationUsdExact: canonical?.valuation?.valueExact ?? previous?.valuationUsdExact ?? null,
    valuationAnswerRaw: canonical?.valuation?.answerRaw ?? canonical?.valuation?.feed?.answerRaw ?? previous?.valuationAnswerRaw ?? null,
    fieldStatus: { totalSupply: totalSupply.status, holders: holders.status, symbol: symbol.status, tokenName: tokenName.status, valueUsd: valueUsd.status, valuationUsd: valuationUsd.status },
    valuationFeed: canonical?.valuation?.feed || null,
    supplementalFeeds: canonical?.supplementalFeeds || [],
    valueStatus: canonical?.valueUsd || null,
    tokenStatus: canonical?.token || null,
    gatewayStatus: canonical?.status || (canonicalTokenized ? 'unavailable' : 'gateway-unavailable'),
    gatewayBlock: canonicalTokenized?.block || null,
    explorer: `https://snowscan.xyz/address/${contract.address}`,
    confidence: protocol.confidence, source: 'Canonical Avalanche Chain Gateway + exact-contract holder-count source',
    issuer: protocol.issuer || null, issuerUrl: protocol.issuerUrl || null, productUrl: protocol.productUrl || null,
    sourceLinks: protocol.sourceLinks || [], classification: protocol.classification || 'verified-native-issuance',
    valuationBasis: canonical?.valuationBasis || 'Canonical feed unavailable',
    observedAt: canonicalTokenized?.block?.timestamp || null,
    supplyObservedAt: totalSupply.status.observedAt,
    valuationObservedAt: valuationUsd.status.observedAt,
    valueObservedAt: valueUsd.status.observedAt,
    holderObservedAt: holders.status.observedAt,
    holderLabel: 'Exact-contract address count; summed counts are not unique investors',
    errors: {
      totalSupply: totalSupply.status.error,
      valueUsd: valueUsd.status.error,
      holders: holders.status.error,
    },
  };
}))).filter(Boolean);
// An empty valuation set is unavailable, not a measured zero. Preserve that
// distinction through the overview and tokenized-asset headline cards.
const tokenValuesUsd = tokenRows.map((token) => token.valueUsd).filter(Number.isFinite);
const verifiedContractValueUsd = tokenValuesUsd.length === tokenRows.length ? sum(tokenValuesUsd) : null;
const rwaAdapterTvlUsd = sum(rwaProtocols.map((protocol) => protocol.tvl));
const tokenizedKpis = summarizeTokenized(tokenRows, rwaProtocols.length ? rwaAdapterTvlUsd : null);
const rwaAssetRows = rwaPageResults.map(({ asset, result }) => {
  if (!result.ok) {
    return {
      ...asset,
      supply: null,
      navUsd: null,
      valueUsd: null,
      sourceAsOf: null,
      fetchedAt: result.fetchedAt || null,
      ok: false,
      error: result.error || 'RWA.xyz page unavailable',
    };
  }
  try {
    return {
      ...parseRwaAssetPage(result.data, { ...asset, fetchedAt: result.fetchedAt }),
      ok: true,
      error: null,
    };
  } catch (error) {
    return {
      ...asset,
      supply: null,
      navUsd: null,
      valueUsd: null,
      sourceAsOf: null,
      fetchedAt: result.fetchedAt || null,
      ok: false,
      error: error.message,
    };
  }
});
const tokenizedEvidence = composeTokenizedEvidence({ canonicalSnapshot: canonicalTokenized, comparators: rwaAssetRows });
const verifiedValueHistory = tokenizedEvidence.valueHistory.length ? tokenizedEvidence.valueHistory : previousDashboard.tokenizedAssets?.valueHistorySource === 'canonical-observations' ? previousDashboard.tokenizedAssets.valueHistory : [];
const previousHolderHistory = await readJson(HOLDER_HISTORY, []);
const holderPoint = {
  timestamp: new Date().toISOString(),
  date: new Date().toISOString().slice(0, 10),
  values: Object.fromEntries(tokenRows.map((token) => [token.id, token.holders])),
  fieldStatus: Object.fromEntries(tokenRows.map((token) => [token.id, { ...token.fieldStatus.holders, source: 'routescan-exact-contract-holder-count' }])),
};
const holderHistory = [...previousHolderHistory.filter((point) => point.date !== holderPoint.date), holderPoint].slice(-730);
// Holder history is committed only after successful dashboard composition.

const activityByToken = tokenRows.map((token) => ({
  ...token,
  history: (tokenActivity.daily || []).filter((row) => row.tokenId === token.id).map((row) => ({
    ...row,
    minted: token.decimals == null ? null : Number(row.minted_raw) / (10 ** token.decimals),
    burned: token.decimals == null ? null : Number(row.burned_raw) / (10 ** token.decimals),
  })),
  holderHistory: holderHistory.map((point) => ({ date: point.date, holders: point.values[token.id] ?? null, ...(point.fieldStatus?.[token.id] || { availability: 'unknown', observedAt: null, retainedLastGood: false, source: 'legacy-holder-history' }) })),
}));

async function labelContract(row) {
  for (const protocol of registry.protocols || []) {
    const match = protocol.contracts?.find((contract) => contract.address.toLowerCase() === row.address);
    if (match) return { ...row, label: `${protocol.name}: ${match.role}`, protocol: protocol.name, confidence: protocol.confidence };
  }
  const result = await fetchJson(`${urls.routescan}?module=contract&action=getsourcecode&address=${row.address}`);
  const body = result.data;
  const source = body?.status === '1' && Array.isArray(body.result) ? body.result[0] : null;
  const contractName = source?.ContractName || null;
  return { ...row, label: contractName || 'Unlabeled contract', protocol: null, confidence: contractName ? 'medium' : 'low' };
}

const labeledTop = await Promise.all((blockspace.topContracts || []).slice(0, 25).map(labelContract));
const topContracts = [...labeledTop, ...(blockspace.topContracts || []).slice(25).map((row) => ({
  ...row,
  label: 'Unlabeled contract',
  protocol: null,
  confidence: 'low',
}))];

const latestBlock = blockResult.data || {};
const avaxMarket = avaxPriceResult.data?.['avalanche-2'] || {};
const avaxPrice = safeNumber(avaxMarket.usd ?? avaxFallbackResult.data?.quotes?.USD?.price);
const avaxMarketCap = safeNumber(avaxMarket.usd_market_cap ?? avaxFallbackResult.data?.quotes?.USD?.market_cap);
const feeDaily = (blockspace.daily || []).map((row) => ({
  date: row.date,
  feesAvax: row.fees_burned_avax,
  feesUsd: avaxPrice == null ? null : row.fees_burned_avax * avaxPrice,
  averageFeeAvax: row.average_fee_avax,
  averageFeeUsd: avaxPrice == null ? null : row.average_fee_avax * avaxPrice,
  medianFeeAvax: row.median_fee_avax,
  medianFeeUsd: avaxPrice == null ? null : row.median_fee_avax * avaxPrice,
  note: avaxPrice == null ? 'USD value unavailable' : 'USD uses current AVAX price and is explicitly not historical-price adjusted',
}));
const coveredFeesAvax = sum(feeDaily.map((row) => row.feesAvax));
const coveredFeesUsdCurrentPrice = avaxPrice == null ? null : coveredFeesAvax * avaxPrice;
const annualizedFees = feeDaily.map((row, index, rows) => {
  const avg = (days) => {
    const window = rows.slice(Math.max(0, index - days + 1), index + 1).map((point) => point.feesAvax);
    return window.length ? sum(window) / window.length * 365 : null;
  };
  return { date: row.date, avax7d: avg(7), avax30d: avg(30) };
});

const sourceHealth = [
  sourceState(blockResult, 'avalanche-public-rpc'),
  sourceState(chainTvlResult, 'defillama-tvl'),
  sourceState(dexResult, 'defillama-dimensions'),
  sourceState(stablecoinsResult, 'defillama-stablecoins'),
  sourceState(yieldsResult, 'defillama-yields'),
  sourceState(avaxPriceResult.ok ? avaxPriceResult : avaxFallbackResult, avaxPriceResult.ok ? 'coingecko' : 'coinpaprika'),
  { id: 'avacache-parquet', ok: Boolean(blockspace.daily?.length), fetchedAt: blockspace.generatedAt || null, latencyMs: null, error: null },
  { id: 'avalanche-gateway-tokenized-assets', ok: Boolean(canonicalTokenized), fetchedAt: canonicalTokenized?.generatedAt || canonicalTokenizedResult.fetchedAt, latencyMs: canonicalTokenizedResult.latencyMs, error: canonicalTokenized ? null : canonicalTokenizedResult.error || 'invalid canonical tokenized-assets schema' },
  canonicalLendingSourceHealth(lendingMetrics),
];
const failedSources = sourceHealth.filter((source) => !source.ok);
const latestCompleteDate = blockspace.coverage?.end || null;
const currentDate = new Date().toISOString().slice(0, 10);

const chainTvlHistory = (chainTvlResult.data || []).slice(-730).map((point) => ({ date: unixDate(point.date), total: safeNumber(point.tvl) }));
const latestBlockspaceDay = (blockspace.daily || []).find((row) => row.date === latestCompleteDate) || null;
const currentChainTvl = safeNumber((chainsResult.data || []).find((chain) => chain.name === 'Avalanche')?.tvl);
const rwaRequiredRows = rwaAssetRows.filter((row) => ['buidl', 'vbill', 'acred'].includes(row.assetId));
const rwaRequiredValueUsd = rwaRequiredRows.length === 3 && rwaRequiredRows.every((row) => row.ok && row.valueUsd != null)
  ? sum(rwaRequiredRows.map((row) => row.valueUsd))
  : null;
const verificationChecks = [
  buildVerificationCheck({
    id: 'defillama-chain-tvl-consistency',
    category: 'ecosystem',
    label: 'Avalanche protocol TVL',
    metricId: 'protocol_tvl',
    unit: 'USD',
    observedValue: latestValue(chainTvlHistory, 'total'),
    comparatorValue: currentChainTvl,
    comparatorLabel: 'DeFiLlama current chains endpoint',
    sourceId: 'defillama-tvl',
    sourceName: 'DeFiLlama',
    sourceUrl: 'https://defillama.com/chain/Avalanche',
    sourceAsOf: currentDate,
    fetchedAt: chainsResult.fetchedAt,
    scope: 'Avalanche chain TVL; current endpoint versus latest historical-chain observation.',
    comparability: 'qualified',
    independence: 'same-provider',
    tolerancePct: 1,
    note: 'Consistency check across two DeFiLlama endpoints; this is not independent verification.',
  }),
  buildVerificationCheck({
    id: 'avalanche-daily-transactions',
    category: 'blockspace',
    label: `Daily transactions · ${latestCompleteDate}`,
    metricId: 'daily_transactions',
    unit: 'transactions',
    observedValue: latestBlockspaceDay?.transactions,
    comparatorValue: avalancheMetricValue('txCount'),
    comparatorLabel: 'Avalanche Metrics API txCount',
    sourceId: 'avalanche-metrics-api',
    sourceName: 'Avalanche Builder Hub',
    sourceUrl: 'https://build.avax.network/docs/api-reference/metrics-api/chain-metrics/getEvmChainMetrics',
    sourceAsOf: latestCompleteDate,
    fetchedAt: avalancheMetricResults.txCount?.fetchedAt,
    scope: 'Exact Avalanche C-Chain UTC day and transaction-count definition.',
    tolerancePct: 0.01,
    note: 'Local parquet count is checked against Avalanche’s official indexed metric.',
  }),
  buildVerificationCheck({
    id: 'avalanche-average-gas-price',
    category: 'blockspace',
    label: `Average gas price · ${latestCompleteDate}`,
    metricId: 'average_gas_price',
    unit: 'Gwei',
    observedValue: latestBlockspaceDay?.average_gas_price_gwei,
    comparatorValue: avalancheMetricValue('avgGasPrice'),
    comparatorLabel: 'Avalanche Metrics API avgGasPrice',
    sourceId: 'avalanche-metrics-api',
    sourceName: 'Avalanche Builder Hub',
    sourceUrl: 'https://build.avax.network/docs/api-reference/metrics-api/chain-metrics/getEvmChainMetrics',
    sourceAsOf: latestCompleteDate,
    fetchedAt: avalancheMetricResults.avgGasPrice?.fetchedAt,
    scope: 'Exact Avalanche C-Chain UTC day; transaction-weighted effective gas price in Gwei.',
    tolerancePct: 0.01,
    note: 'Both sources derive the metric from transaction receipt gas prices.',
  }),
  buildVerificationCheck({
    id: 'avalanche-fees-paid',
    category: 'blockspace',
    label: `C-Chain fee burn · ${latestCompleteDate}`,
    metricId: 'transaction_fees_burned',
    unit: 'AVAX',
    observedValue: latestBlockspaceDay?.fees_burned_avax,
    comparatorValue: avalancheMetricValue('feesPaid'),
    comparatorLabel: 'Avalanche Metrics API feesPaid',
    sourceId: 'avalanche-metrics-api',
    sourceName: 'Avalanche Builder Hub',
    sourceUrl: 'https://build.avax.network/docs/api-reference/metrics-api/chain-metrics/getEvmChainMetrics',
    sourceAsOf: latestCompleteDate,
    fetchedAt: avalancheMetricResults.feesPaid?.fetchedAt,
    scope: 'Exact Avalanche C-Chain UTC day; sum of gas used multiplied by effective gas price.',
    tolerancePct: 0.01,
    note: 'Avalanche C-Chain fees are burned; this is not validator revenue.',
  }),
  buildVerificationCheck({
    id: 'avalanche-active-sender-scope',
    category: 'blockspace',
    label: `Active sender scope · ${latestCompleteDate}`,
    metricId: 'active_addresses',
    unit: 'addresses',
    observedValue: latestBlockspaceDay?.active_addresses,
    comparatorValue: avalancheMetricValue('activeSenders'),
    comparatorLabel: 'Avalanche Metrics API activeSenders',
    sourceId: 'avalanche-metrics-api',
    sourceName: 'Avalanche Builder Hub',
    sourceUrl: 'https://build.avax.network/docs/api-reference/metrics-api/chain-metrics/getEvmChainMetrics',
    sourceAsOf: latestCompleteDate,
    fetchedAt: avalancheMetricResults.activeSenders?.fetchedAt,
    scope: 'Context only: Observatory counts transaction.from; Avalanche also counts from-addresses found in transfer logs.',
    comparability: 'context',
    tolerancePct: null,
    note: 'The different definitions are disclosed instead of forcing agreement.',
  }),
  buildVerificationCheck({
    id: 'avalanche-contract-creation-scope',
    category: 'blockspace',
    label: `Contract creation scope · ${latestCompleteDate}`,
    metricId: 'contract_creations',
    unit: 'contracts',
    observedValue: latestBlockspaceDay?.contract_creations,
    comparatorValue: avalancheMetricValue('contracts'),
    comparatorLabel: 'Avalanche Metrics API contracts',
    sourceId: 'avalanche-metrics-api',
    sourceName: 'Avalanche Builder Hub',
    sourceUrl: 'https://build.avax.network/docs/api-reference/metrics-api/chain-metrics/getEvmChainMetrics',
    sourceAsOf: latestCompleteDate,
    fetchedAt: avalancheMetricResults.contracts?.fetchedAt,
    scope: 'Context only: Observatory counts top-level creations; Avalanche includes internal CREATE, CREATE2, and CREATE3 traces.',
    comparability: 'context',
    tolerancePct: null,
    note: 'The official total is broader by construction and is not a failed parity check.',
  }),
  buildVerificationCheck({
    id: 'avax-price-cross-check',
    category: 'market',
    label: 'AVAX spot price',
    metricId: 'avax_market_cap',
    unit: 'USD',
    observedValue: safeNumber(avaxMarket.usd),
    comparatorValue: safeNumber(avaxFallbackResult.data?.quotes?.USD?.price),
    comparatorLabel: 'CoinPaprika AVAX price',
    sourceId: 'coinpaprika',
    sourceName: 'CoinPaprika',
    sourceUrl: 'https://coinpaprika.com/coin/avax-avalanche/',
    sourceAsOf: avaxFallbackResult.fetchedAt,
    fetchedAt: avaxFallbackResult.fetchedAt,
    scope: 'Current AVAX/USD spot observations fetched in the same collector cycle.',
    comparability: 'qualified',
    tolerancePct: 2,
    note: 'CoinGecko is the observed source; this check is unavailable when its unauthenticated endpoint is rate limited.',
  }),
];

for (const rwa of rwaAssetRows) {
  const token = tokenRows.find((row) => row.id === rwa.assetId);
  verificationChecks.push(buildVerificationCheck({
    id: `rwa-${rwa.assetId}-supply`,
    category: 'tokenized',
    label: `${rwa.ticker} circulating supply`,
    metricId: 'tokenized_asset_value',
    unit: 'tokens',
    observedValue: token?.totalSupply,
    comparatorValue: rwa.supply,
    comparatorLabel: 'RWA.xyz Avalanche C-Chain supply',
    sourceId: 'rwa-xyz-public',
    sourceName: 'RWA.xyz',
    sourceUrl: rwa.url,
    sourceAsOf: rwa.sourceAsOf,
    fetchedAt: rwa.fetchedAt,
    scope: `Exact contract ${rwa.address} on Avalanche C-Chain.`,
    tolerancePct: 0.05,
    note: rwa.error || 'On-chain totalSupply is compared with the exact-address RWA.xyz token row.',
  }));
  if (rwa.assetId !== 'secz') {
    verificationChecks.push(buildVerificationCheck({
      id: `rwa-${rwa.assetId}-value`,
      category: 'tokenized',
      label: `${rwa.ticker} verified contract value`,
      metricId: 'tokenized_asset_value',
      unit: 'USD',
      observedValue: token?.valueUsd,
      comparatorValue: rwa.valueUsd,
      comparatorLabel: 'RWA.xyz Avalanche C-Chain value',
      sourceId: 'rwa-xyz-public',
      sourceName: 'RWA.xyz',
      sourceUrl: rwa.url,
      sourceAsOf: rwa.sourceAsOf,
      fetchedAt: rwa.fetchedAt,
      scope: `Exact contract ${rwa.address}; RWA.xyz market value versus Observatory mapped value.`,
      comparability: 'qualified',
      tolerancePct: 0.5,
      note: rwa.error || 'Small timing and NAV-method differences are allowed; RWA.xyz never overwrites the dashboard value.',
    }));
  } else {
    verificationChecks.push(buildVerificationCheck({
      id: 'rwa-secz-value',
      category: 'tokenized',
      label: 'SECZ value evidence',
      metricId: 'tokenized_asset_value',
      unit: 'USD',
      observedValue: token?.valueUsd,
      comparatorValue: rwa.valueUsd,
      comparatorLabel: 'RWA.xyz Avalanche C-Chain value',
      sourceId: 'rwa-xyz-public',
      sourceName: 'RWA.xyz',
      sourceUrl: rwa.url,
      sourceAsOf: rwa.sourceAsOf,
      fetchedAt: rwa.fetchedAt,
      scope: `Exact contract ${rwa.address}; RedStone end-of-day equity price and RWA.xyz price are separate time/method observations, not identical NAV measurements.`,
      comparability: 'context',
      tolerancePct: null,
      note: 'RWA.xyz currently reports a value, but verification evidence does not silently promote it into the canonical KPI.',
    }));
  }
}

verificationChecks.push(buildVerificationCheck({
  id: 'rwa-verified-contract-total',
  category: 'tokenized',
  label: 'Verified tokenized contract value',
  metricId: 'tokenized_asset_value',
  unit: 'USD',
  observedValue: tokenRows.filter(row => row.id !== 'secz').every(row => Number.isFinite(row.valueUsd)) ? sum(tokenRows.filter(row => row.id !== 'secz').map(row => row.valueUsd)) : null,
  comparatorValue: rwaRequiredValueUsd,
  comparatorLabel: 'RWA.xyz exact-contract sum',
  sourceId: 'rwa-xyz-public',
  sourceName: 'RWA.xyz',
  sourceUrl: 'https://app.rwa.xyz/networks/avalanche',
  sourceAsOf: rwaRequiredRows.find((row) => row.sourceAsOf)?.sourceAsOf || null,
  fetchedAt: rwaRequiredRows.find((row) => row.fetchedAt)?.fetchedAt || null,
  scope: 'BUIDL, VBILL, and ACRED exact Avalanche C-Chain contracts. SECZ uses an EOD equity price and is excluded from this NAV-only comparison, not from the four-asset headline.',
  comparability: 'qualified',
  tolerancePct: 0.5,
  note: 'This aggregate is distinct from RWA.xyz’s broader all-Avalanche universe and DeFiLlama RWA protocol-adapter TVL.',
}));

const verificationSummary = summarizeVerification(verificationChecks);
const verificationSourceHealth = [
  {
    id: 'rwa-xyz-public',
    ok: rwaRequiredRows.every((row) => row.ok),
    required: false,
    role: 'verification',
    fetchedAt: rwaRequiredRows.find((row) => row.fetchedAt)?.fetchedAt || null,
    coverage: `${rwaAssetRows.filter((row) => row.ok).length}/${rwaAssetRows.length} exact contract pages parsed`,
    error: rwaRequiredRows.find((row) => !row.ok)?.error || null,
  },
  {
    id: 'avalanche-metrics-api',
    ok: avalancheMetricNames.every((metric) => avalancheMetricResults[metric]?.ok && avalancheMetricValue(metric) != null),
    required: false,
    role: 'verification',
    fetchedAt: avalancheMetricResults.txCount?.fetchedAt || null,
    coverage: `${avalancheMetricNames.filter((metric) => avalancheMetricValue(metric) != null).length}/${avalancheMetricNames.length} daily metrics; 3 exact-scope and 2 context-only`,
    error: avalancheMetricNames.map((metric) => avalancheMetricResults[metric]?.error).find(Boolean) || null,
  },
];
const payload = {
  schema: 'couchdicks.avalanche.ecosystem-dashboard.v1',
  generatedAt: new Date().toISOString(),
  metadata: {
    title: 'Avalanche Ecosystem Observatory',
    chain: 'Avalanche C-Chain',
    chainId: 43114,
    productionPath: '/avalanche/ecosystem/',
    latestCompleteDate,
    partialDay: currentDate !== latestCompleteDate,
    coverageStart: blockspace.coverage?.start || null,
    freshness: failedSources.length ? 'degraded' : 'healthy',
    indexingLagDays: latestCompleteDate ? Math.max(0, Math.floor((Date.now() - Date.parse(`${latestCompleteDate}T23:59:59Z`)) / 86_400_000)) : null,
    warnings: [
      ...(failedSources.length ? [`${failedSources.length} upstream source(s) failed during this refresh.`] : []),
      'Blockspace history begins at the local verified parquet coverage start.',
      'Historical fee USD values are withheld from headline methodology because the current collector has no observation-date AVAX price series.',
      'Pair-level DEX categories and bridge net flows remain unsupported until contract-complete pool and bridge registries are verified.',
    ],
  },
  status: {
    healthy: blockResult.ok && gasPriceResult.ok,
    blockNumber: latestBlock.number ? Number(BigInt(latestBlock.number)) : null,
    blockTimestamp: latestBlock.timestamp ? new Date(Number(BigInt(latestBlock.timestamp)) * 1000).toISOString() : null,
    baseFeeGwei: latestBlock.baseFeePerGas ? Number(BigInt(latestBlock.baseFeePerGas)) / 1e9 : null,
    gasPriceGwei: gasPriceResult.data ? Number(BigInt(gasPriceResult.data)) / 1e9 : null,
    avaxPriceUsd: avaxPrice,
    avaxMarketCapUsd: avaxMarketCap,
    avaxChange24hPct: safeNumber(avaxMarket.usd_24h_change ?? avaxFallbackResult.data?.quotes?.USD?.percent_change_24h),
    rpcLatencyMs: blockResult.latencyMs,
  },
  overview: {
    kpis: {
      avaxMarketCapUsd: avaxMarketCap,
      stablecoinMarketCapUsd: stablecoinMarketCap,
      tokenizedAssetValueUsd: verifiedContractValueUsd,
      rwaAdapterTvlUsd,
      protocolTvlUsd: latestValue(chainTvlHistory, 'total'),
    },
    protocolTvl: {
      totalHistory: chainTvlHistory,
      protocolHistory: protocolSeries,
      protocols: materialProtocols.slice(0, 30),
      byType: protocolTypes,
      byTypeAccounting: {
        additive: false,
        grossAdapterTvlUsd: sum(protocolTypes.map((row) => row.value)),
        chainTvlUsd: latestValue(chainTvlHistory, 'total'),
        explanation: 'Category values are gross protocol-adapter observations. Vaults, allocators, RWAs, wrappers, and their underlying protocols can overlap, so categories must not be summed or treated as chain-TVL shares.',
      },
    },
    assetLandscape: [
      { name: 'AVAX market cap', value: avaxMarketCap, availability: avaxMarketCap == null ? 'unavailable' : 'available' },
      { name: 'Stablecoins', value: stablecoinMarketCap, availability: 'available' },
      { name: 'Verified tokenized contracts', value: verifiedContractValueUsd, availability: verifiedContractValueUsd == null ? 'unavailable' : 'available' },
    ],
    stablecoins: {
      history: stableHistory,
      assets: stableAssets.slice(0, 30),
      composition: {
        headlineTotalUsd: stablecoinMarketCap,
        topTenSubtotalUsd: stablecoinTopTenUsd,
        otherUsd: stablecoinOtherUsd,
        topTenCoveragePct: stablecoinTopTenCoveragePct,
        excludedSymbols: ['BUIDL'],
        roundingToleranceUsd: 1,
      },
    },
    bridges: {
      trackedValueUsd: sum(bridgeProtocols.map((protocol) => protocol.tvl)),
      protocols: bridgeProtocols,
      flowHistory: [],
      coverage: 'Adapter balances do not measure bridge flow, capacity, redeemability, security, or operational health. Inflow, outflow, and net flow are withheld because no contract-complete non-duplicative bridge event registry is active. Operational status remains Unknown until an evidence-backed manual review records a source URL and checked-at time.',
    },
    ammLiquidity: {
      valueUsd: sum(materialProtocols.filter((protocol) => protocol.category === 'Dexs').map((protocol) => protocol.tvl)),
      protocols: materialProtocols.filter((protocol) => protocol.category === 'Dexs').slice(0, 30),
      positiveAdapterCount: materialProtocols.filter((protocol) => protocol.category === 'Dexs').length,
      visibleAdapterCount: Math.min(30, materialProtocols.filter((protocol) => protocol.category === 'Dexs').length),
      omittedAdapterCount: Math.max(0, materialProtocols.filter((protocol) => protocol.category === 'Dexs').length - 30),
      omittedTvlUsd: sum(materialProtocols.filter((protocol) => protocol.category === 'Dexs').slice(30).map((protocol) => protocol.tvl)),
      qualification: 'Protocol TVL proxy; pool-level balances are not complete for every architecture.',
    },
    dex: {
      totalHistory: dexTotal,
      breakdownHistory: dexBreakdown,
      protocols: dexProtocols,
      architectureComposition: Object.entries(architectureComposition).map(([name, value]) => ({ name, value })),
      architectureCoverage: {
        window: architectureWindow,
        date: currentDexDay.date || null,
        totalVolumeUsd: currentDexDayVolumeUsd,
        classifiedVolumeUsd: classifiedArchitectureVolume24h,
        unclassifiedTimingGapUsd: architectureTimingGap24h,
        classification: 'dashboard-maintained',
        methodology: 'Protocol names are mapped by the dashboard dexArchitecture classifier; this is not independently verified.',
        lastReviewedAt: new Date().toISOString(),
      },
      pairCategories: [],
      pairCoverage: 'Unavailable: pair-level classification is withheld until token and pool registries cover all material factories without aggregator or multi-hop double counting.',
    },
    deployments: {
      history: (blockspace.daily || []).map((row) => ({ date: row.date, allContractCreations: row.contract_creations })),
      factorySeries: [],
      coverage: 'All top-level contract creations are available. Launchpad-only token deployments are withheld pending verified factory-event coverage.',
    },
  },
  blockspace: {
    coverage: blockspace.coverage,
    daily: blockspace.daily || [],
    topContracts,
  },
  economics: {
    coverage: blockspace.coverage,
    kpis: {
      coveredFeesBurnedAvax: coveredFeesAvax,
      coveredFeesBurnedUsdCurrentPrice: coveredFeesUsdCurrentPrice,
      issuanceAvax: null,
      netIssuanceAvax: null,
      validatorRevenueUsd: null,
    },
    feeHistory: feeDaily,
    annualizedHistory: annualizedFees,
    costBreakdown: [],
    explanation: 'Avalanche C-Chain transaction fees, including base and priority portions, are burned. They are not validator fee revenue. Operating cost, gross profit, and margin are therefore not asserted.',
    thirdPartyFeeHistory: (feesResult.data?.totalDataChart || []).slice(-365).map(([timestamp, value]) => ({ date: unixDate(timestamp), protocolFeesUsd: safeNumber(value) })),
  },
  spot: {
    ammLiquidityUsd: sum(materialProtocols.filter((protocol) => protocol.category === 'Dexs').map((protocol) => protocol.tvl)),
    volume24hUsd: latestCompleteDexVolumeUsd,
    volume24hLabel: 'Latest complete UTC day',
    volume7dUsd: safeNumber(dexResult.data?.total7d),
    volume30dUsd: safeNumber(dexResult.data?.total30d),
    totalHistory: dexTotal,
    breakdownHistory: dexBreakdown,
    protocols: dexProtocols,
    architectureComposition: Object.entries(architectureComposition).map(([name, value]) => ({ name, value })),
    architectureCoverage: {
      window: architectureWindow,
      date: currentDexDay.date || null,
      totalVolumeUsd: currentDexDayVolumeUsd,
      classifiedVolumeUsd: classifiedArchitectureVolume24h,
      unclassifiedTimingGapUsd: architectureTimingGap24h,
      classification: 'dashboard-maintained',
      methodology: 'Protocol names are mapped by the dashboard dexArchitecture classifier; this is not independently verified.',
      lastReviewedAt: new Date().toISOString(),
    },
    pairCategories: [],
  },
  tokenizedAssets: {
    schema: 'couchdicks.avalanche.tokenized-assets.v2',
    generatedAt: new Date().toISOString(),
    kpis: tokenizedKpis,
    valueHistory: verifiedValueHistory,
    valueHistorySource: 'canonical-observations',
    rwaAdapterValueHistory: rwaHistory,
    protocols: rwaProtocols,
    assets: activityByToken,
    activityStatus: activityFreshness(tokenActivity),
    canonicalSnapshot: canonicalTokenized ? {
      source: canonicalTokenized.source,
      schemaVersion: canonicalTokenized.schemaVersion,
      generatedAt: canonicalTokenized.generatedAt,
      block: canonicalTokenized.block,
      coverage: canonicalTokenized.coverage,
      aggregateValueUsd: canonicalTokenized.aggregateValueUsd,
    } : { source: 'avalanche_gateway', availability: 'unavailable', error: canonicalTokenizedResult.error || 'invalid canonical snapshot' },
    holderDefinition: 'Summed exact-contract address counts across four token contracts; an address appearing in multiple contracts is counted once per contract and is not a unique-investor count.',
    scope: {
      nativeIssuance: 'Registry-authenticated token contracts issued natively on Avalanche C-Chain.',
      excluded: ['ordinary stablecoins', 'bridged wrappers', 'unverified token contracts'],
      separate: ['DeFiLlama RWA adapter TVL', 'RWA.xyz comparator observations'],
      completeness: 'Curated verified-contract set; not a claim of complete Avalanche RWA coverage.',
    },
    holderHistoryCoverageStart: holderHistory[0]?.date || null,
    dexVolume: [],
    dexCoverage: 'Asset-level DEX volume is withheld until verified pool coverage can distinguish direct swaps from multi-hop routes and internal vault activity.',
    venueLandscape: tokenizedStockVenueLandscape(),
  },
  lending: {
    ...AVALANCHE_LENDING_SCOPE,
    kpis: {
      totalSuppliedUsd: lendingMetrics.aggregates?.suppliedUsd ?? null,
      totalBorrowedUsd: lendingMetrics.aggregates?.borrowedUsd ?? sum(lendingDetails.map((row) => row.borrowed)),
      netTvlUsd: sum(lendingDetails.map((row) => row.netTvl)),
      availableLiquidityUsd: lendingMetrics.aggregates?.availableLiquidityUsd ?? null,
      factoryVaultAssetsUsd: lendingMetrics.vaults?.grossAssetsUsd ?? null,
      liquidations30d: lendingMetrics.liquidations?.totalEvents ?? null,
      liquidationDebtRepaidUsd30d: lendingMetrics.liquidations?.debtRepaidUsd ?? null,
    },
    protocols: lendingMetrics.protocols?.length ? lendingMetrics.protocols : lendingDetails,
    protocolLiquidityCoverage: (lendingMetrics.protocols?.length ? lendingMetrics.protocols : lendingDetails).map((row) => ({
      slug: row.slug,
      ...AVALANCHE_LENDING_SCOPE,
      availability: row.availability,
      fieldProvenance: row.fieldProvenance,
    })),
    history: lendingHistory,
    sourceHistories: lendingMetrics.histories || [],
    markets: lendingMarketPartitions.ordinary,
    impairedMarkets: lendingMarketPartitions.impaired,
    marketAccountingValidation: { valid: true, issues: [] },
    marketAvailability: lendingMetrics.markets?.state || 'unavailable',
    marketCoverage: lendingMetrics.markets?.protocolCoverage || [],
    vaults: lendingMetrics.vaults?.rows || [],
    vaultSummary: lendingMetrics.vaults || null,
    vaultAvailability: lendingMetrics.vaults?.state || 'unavailable',
    liquidationHistory: lendingMetrics.liquidations?.history || [],
    liquidationEvents: lendingMetrics.liquidations?.events || [],
    liquidationProtocols: lendingMetrics.liquidations?.protocols || [],
    liquidationAvailability: lendingMetrics.liquidations?.state || 'unavailable',
    liquidationCoverage: lendingMetrics.liquidations?.coverage || null,
    fixedBlock: lendingMetrics.fixedBlock || null,
  },
  quality: {
    sourceHealth,
    verificationSourceHealth,
    verification: {
      schema: 'couchdicks.avalanche.verification.v1',
      generatedAt: new Date().toISOString(),
      policy: {
        scoredComparability: ['exact', 'qualified'],
        unscoredStatuses: ['context', 'unavailable'],
        rule: 'A check passes only when scopes are exact or explicitly qualified and absolute percent variance is within its declared tolerance. Comparator failures never replace or zero canonical metrics.',
        excludedAreas: ['complete stablecoin coverage', 'DEX architecture', 'bridge health', 'lending markets', 'rates', 'vault accounting', 'liquidations', 'deployment history'],
        scopeDisclosure: 'Passing scoped checks do not certify the full dashboard or validate every stablecoin, DEX architecture, bridge-health, lending-market, rate, vault, liquidation, or deployment-history datum.',
      },
      summary: verificationSummary,
      checks: verificationChecks,
      rwaAssets: rwaAssetRows,
    },
    sourceCatalog,
    metricCatalog,
    protocolRegistry: registry,
  },
};

const referenceLlama = { sourceLabel: 'DeFiLlama Avalanche-only reference', observedAt: payload.generatedAt, protocols: lendingDetails, availability: lendingDetails.every((row) => row.netTvl != null) ? 'available' : 'partial', families: LENDING_REFERENCE_SLUGS };
await writeJsonAtomic(path.join(ROOT, 'state/lending-reference.json'), referenceLlama);
payload.lending.historyCoverage = { sourceLabel: 'DeFiLlama Avalanche-only reference', families: LENDING_REFERENCE_SLUGS, observedAt: payload.generatedAt };
const refreshedLending = updateDashboardLending(payload, lendingMetrics, referenceLlama);
payload.lending = refreshedLending.lending;
payload.quality = refreshedLending.quality;
const publication = updateDashboardTokenized(payload, canonicalTokenized);
await writeJsonAtomic(STATE_OUTPUT, publication);
await publishSnapshotBundle(ROOT, {'dashboard.json': publication, 'blockspace.json': blockspace, 'tokenized-activity.json': tokenActivity});
await writeJsonAtomic(HOLDER_HISTORY, holderHistory);
await writeJsonAtomic(CHECKPOINT, {
  lastSuccessfulRefresh: payload.generatedAt,
  latestCompleteDate,
  blockNumber: payload.status.blockNumber,
  sourceHealth,
  schema: payload.schema,
});
console.log(`wrote ${STATE_OUTPUT}`);
console.log(`freshness=${payload.metadata.freshness} block=${payload.status.blockNumber} completeThrough=${latestCompleteDate}`);

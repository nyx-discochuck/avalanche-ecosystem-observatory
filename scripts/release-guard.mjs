import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib.mjs';
import { validateDashboard } from './dashboard-invariants.mjs';

const command = process.argv[2];
const backupRoot = process.env.RELEASE_BACKUP_DIR || path.join(ROOT, '.release', 'rollback');
const publicOrigin = (process.env.RELEASE_PUBLIC_ORIGIN || 'https://couchdicks.org').replace(/\/$/, '');
const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

function run(program, args) {
  const result = spawnSync(program, args, { cwd: ROOT, stdio: 'inherit' });
  invariant(result.status === 0, `${program} ${args.join(' ')} failed with status ${result.status}`);
}

export function validateLending(payload) {
  validateDashboard(payload);
  const lending = payload?.lending;
  invariant(payload?.schema === 'couchdicks.avalanche.ecosystem-dashboard.v1', 'unexpected dashboard schema');
  invariant(payload?.metadata?.productionPath === '/avalanche/ecosystem/', 'unexpected production path');
  invariant(lending?.chain === 'Avalanche' && lending.network === 'Avalanche C-Chain' && lending.chainId === 43114 && lending.scope === 'Avalanche-only', 'lending aggregate is not Avalanche-scoped');
  const scopedRows = [
    ...(lending.protocols || []),
    ...(lending.protocolLiquidityCoverage || []),
    ...(lending.history || []),
    ...(lending.markets || []),
    ...(lending.impairedMarkets || []),
    ...(lending.marketCoverage || []),
    ...(lending.vaults || []),
    ...(lending.vaultSummary?.protocolCoverage || []),
    ...(lending.liquidationHistory || []),
    ...(lending.liquidationEvents || []),
    ...(lending.liquidationProtocols || []),
  ];
  invariant(scopedRows.length > 0 && scopedRows.every((row) => row.chain === 'Avalanche' && row.chainId === 43114 && row.scope === 'Avalanche-only'), 'one or more lending rows are not Avalanche-scoped');
  invariant((lending.protocols || []).every((row) => row.source && row.coverage && row.fieldProvenance), 'protocol accounting provenance or coverage is incomplete');
  invariant(Number.isFinite(lending.kpis?.totalSuppliedUsd) && Number.isFinite(lending.kpis?.availableLiquidityUsd), 'coverage-qualified lending headlines are unavailable');
  invariant((lending.markets || []).every((row) => row.riskState !== 'impaired'), 'impaired market leaked into ordinary ranking');
  invariant((lending.impairedMarkets || []).every((row) => row.includedInHeadline === false), 'excluded claims enter headline accounting');
  if (lending.fixedBlock) invariant(lending.fixedBlock.number > 0 && lending.fixedBlock.confirmations >= 2, 'fixed block is not confirmed');
  invariant(['available', 'partial', 'stale'].includes(lending.marketAvailability), 'native lending markets are unavailable');
  const native = [...(lending.markets || []), ...(lending.impairedMarkets || [])].filter((row) => ['aave-v3', 'aave-v4', 'benqi', 'euler-v2', 'silo-v2', 'silo-v3'].includes(row.protocol));
  invariant(['aave-v3', 'aave-v4', 'benqi', 'euler-v2', 'silo-v2', 'silo-v3'].every((protocol) => native.some((row) => row.protocol === protocol)), 'required native lending family coverage is empty');
  invariant(new Set(native.map((row) => `${row.protocol}:${row.address}:${row.asset}:${row.spokeAddress || ''}`)).size === native.length, 'native lending market/asset identities are not unique');
  invariant(native.every((row) => row.sourceUrl && row.observedAt && ['APR', 'APY'].includes(row.rateBasis)), 'native market provenance/freshness is incomplete');
  invariant(native.every((row) => ['available', 'partial', 'stale', 'unavailable'].includes(row.state) && ['fresh', 'stale', 'unknown'].includes(row.freshness) && Number.isFinite(row.maxAgeSeconds) && Array.isArray(row.missing)), 'native market degraded-state semantics are incomplete');
  invariant(native.filter((row) => row.state === 'available').every((row) => row.freshness === 'fresh' && row.ageSeconds <= row.maxAgeSeconds), 'available native market is stale');
  invariant(native.every((row) => [row.supplyRatePct, row.borrowRatePct].every(value => value == null || Number.isFinite(value))), 'native market rate is invalid');
  invariant(native.filter((row) => row.state === 'available').every((row) => Number.isFinite(row.totalAssets) && Number.isFinite(row.totalBorrows) && Number.isFinite(row.availableLiquidity)), 'available native market has missing protocol-native accounting metrics');
  invariant((lending.marketCoverage || []).every((row) => row.discovered >= row.eligible + row.excluded && row.eligible >= row.priced && row.sourceUrl), 'native protocol coverage does not reconcile');
  invariant(native.every((row) => [row.supplyRatePct, row.borrowRatePct].every(value => value == null || value >= 0)), 'native rate is negative');
  invariant(native.filter((row) => row.protocol === 'euler-v2').every((row) => row.rateBasis === 'APY' && [row.supplyRatePct,row.borrowRatePct].every(value => value == null || value <= 1_000_000)), 'Euler API basis or bounds are invalid');
  const siloRows = native.filter((row) => /^silo-v/.test(row.protocol));
  invariant(siloRows.every((row) => row.rateBasis === 'APR' && (row.protectedAssets == null || row.borrowableAssets != null)), 'Silo rate or protected collateral basis is invalid');
  invariant(native.filter(row => row.protocol === 'aave-v4' && row.accountingLevel === 'spoke').every(row => row.includedInHeadline === false), 'Aave V4 spokes are additive');
  const siloCoverage = (lending.marketCoverage || []).filter((row) => /^silo-v/.test(row.protocol));
  invariant(siloCoverage.length === 2 && siloCoverage.every((row) => row.discovered >= row.eligible + row.excluded), 'Silo generation coverage is incomplete');
  invariant(lending.vaultSummary?.accounting?.additive === false, 'factory vault totals must remain non-additive');
  if (lending.vaultAvailability !== 'unavailable') invariant(lending.vaultSummary.pricedActiveVaults + lending.vaultSummary.unpricedActiveVaults === lending.vaultSummary.activeVaults, 'factory vault pricing coverage does not reconcile');
  const activeVaults = (lending.vaults || []).filter((row) => row.active);
  invariant(activeVaults.every((row) => row.asset && row.assetSymbol && row.assetSymbol !== 'UNKNOWN'), 'active factory vault token metadata is incomplete');
  invariant(activeVaults.every((row) => !Number.isFinite(row.grossAssetsUsd) || (row.grossAssetsUsd >= 0 && row.grossAssetsUsd <= 100_000_000_000)), 'factory vault USD valuation exceeds the plausibility bound');
  const pricedVaultAssets = activeVaults.reduce((sum, row) => sum + (Number.isFinite(row.grossAssetsUsd) ? row.grossAssetsUsd : 0), 0);
  invariant(pricedVaultAssets <= 500_000_000_000, 'aggregate factory vault USD valuation exceeds the plausibility bound');
  invariant(['available', 'partial'].includes(lending.liquidationAvailability), 'liquidations are unavailable');
  invariant(lending.liquidationHistory?.length > 0, 'retained liquidation history is missing');
  const liquidationEventCount = lending.liquidationEvents?.length || 0;
  invariant(liquidationEventCount === lending.kpis?.liquidations30d, 'liquidation KPI does not match the current 30-day event ledger');
  invariant(new Set(lending.liquidationEvents.map((row) => `${row.transactionHash}:${row.logIndex}`)).size === liquidationEventCount, 'liquidation events are not unique');
  invariant(lending.liquidationProtocols.reduce((sum, row) => sum + row.events, 0) === liquidationEventCount, 'protocol event totals do not reconcile');
  invariant(lending.liquidationHistory.reduce((sum, row) => sum + row.events, 0) === liquidationEventCount, 'daily event totals do not reconcile');
  invariant(lending.liquidationCoverage?.eventCountsExact !== true || lending.liquidationCoverage?.missingProtocols?.length === 0, 'exact liquidation counts cannot have missing protocols');
  invariant((lending.liquidationEvents || []).every((row) => row.debtRepaidUsd == null || (Number.isFinite(row.debtRepaidUsd) && row.debtRepaidUsd >= 0 && row.debtRepaidUsd <= 1_000_000_000)), 'liquidation USD valuation exceeds the per-event plausibility bound');
  const checks = payload?.quality?.verification?.checks || [];
  const summary = payload?.quality?.verification?.summary;
  invariant(checks.length >= 15, 'verification evidence ledger is incomplete');
  invariant(summary?.scored >= 4 && summary.scored === summary.pass + summary.review, 'verification scored coverage is incomplete');
  invariant(summary.review === 0, 'one or more scored verification checks need review');
  invariant(summary.status === 'matched', 'scored verification checks are not matched');
  invariant((payload?.quality?.verificationSourceHealth || []).every((source) => source.required === false), 'verification comparator health must remain optional');
}

async function copyIfPresent(source, destination) {
  try { await stat(source); await cp(source, destination, { recursive: true }); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function copiedFiles(directory, relativePath) {
  const target = path.join(directory, relativePath);
  const info = await stat(target);
  if (info.isFile()) return [relativePath];
  const entries = await readdir(target, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => copiedFiles(directory, path.join(relativePath, entry.name))))).flat();
}

async function prepare() {
  const approvedPath = path.join(ROOT, 'state/dashboard.json');
  validateLending(await json(approvedPath));
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const directory = path.join(backupRoot, `pre-vault-liquidation-${stamp}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const targets = [
    ['dist', 'dist'], ['public/data', 'public-data'], ['state/dashboard.json', 'state-dashboard.json'],
    ['state/lending-metrics.json', 'state-lending-metrics.json'], ['server.mjs', 'server.mjs'],
    ['live-pulse.mjs', 'live-pulse.mjs'], ['radar-adapter.mjs', 'radar-adapter.mjs'],
    ['/home/openclaw/.config/systemd/user/avalanche-ecosystem-dashboard.service', 'avalanche-ecosystem-dashboard.service'],
    ['/home/openclaw/.openclaw/workspace/couchdicks-catalog/server.mjs', 'catalog-server.mjs'],
  ];
  const copied = [];
  for (const [sourceName, destinationName] of targets) {
    const source = sourceName.startsWith('/') ? sourceName : path.join(ROOT, sourceName);
    if (await copyIfPresent(source, path.join(directory, destinationName))) copied.push(destinationName);
  }
  for (const required of ['dist', 'public-data', 'state-dashboard.json', 'server.mjs', 'avalanche-ecosystem-dashboard.service', 'catalog-server.mjs']) invariant(copied.includes(required), `rollback evidence missing: ${required}`);
  const files = (await Promise.all(copied.map((name) => copiedFiles(directory, name)))).flat().sort();
  const manifest = { schema: 'couchdicks.avalanche.release-rollback.v1', createdAt: new Date().toISOString(), root: ROOT, approvedDashboardSha256: await sha256(approvedPath), copied, sha256: Object.fromEntries(await Promise.all(files.map(async (name) => [name, await sha256(path.join(directory, name))]))) };
  await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  for (const [name, digest] of Object.entries((await json(path.join(directory, 'manifest.json'))).sha256)) invariant(await sha256(path.join(directory, name)) === digest, `rollback digest failed: ${name}`);
  run('npm', ['run', 'check']); run('npm', ['test']); run('npm', ['run', 'snapshot:publish']); run('npm', ['run', 'build']);
  invariant(await sha256(path.join(ROOT, 'public/data/dashboard.json')) === manifest.approvedDashboardSha256, 'published fallback differs from approved dashboard');
  console.log(JSON.stringify({ status: 'ready-for-explicit-cutover', rollbackDirectory: directory, manifest: path.join(directory, 'manifest.json') }, null, 2));
}

async function verifyPublic() {
  const approved = await json(path.join(ROOT, 'state/dashboard.json')); validateLending(approved);
  const [htmlResponse, dashboardResponse, healthResponse] = await Promise.all([fetch(`${publicOrigin}/avalanche/ecosystem/`), fetch(`${publicOrigin}/avalanche/ecosystem/api/dashboard`), fetch(`${publicOrigin}/avalanche/ecosystem/api/health`)]);
  invariant(htmlResponse.ok, `public HTML returned ${htmlResponse.status}`); invariant(dashboardResponse.ok, `dashboard API returned ${dashboardResponse.status}`); invariant(healthResponse.ok, `health API returned ${healthResponse.status}`);
  invariant(/assets\/index-[^"']+\.js/.test(await htmlResponse.text()), 'public HTML has no versioned application bundle');
  const dashboard = await dashboardResponse.json(); const health = await healthResponse.json(); validateLending(dashboard);
  invariant(health.status === 'ok', `public health is ${health.status}`); invariant(Number(health.ageSeconds) <= 7200, 'public snapshot is older than 7200 seconds');
  invariant(JSON.stringify(dashboard) === JSON.stringify(approved), 'public dashboard payload differs from approved snapshot');
  console.log(JSON.stringify({ status: 'verified', html: htmlResponse.status, dashboard: dashboardResponse.status, health: healthResponse.status }, null, 2));
}

if (command === 'validate') {
  validateLending(await json(path.join(ROOT, 'state/dashboard.json')));
  console.log(JSON.stringify({ status: 'validated', snapshot: 'state/dashboard.json' }, null, 2));
} else if (command === 'prepare') await prepare();
else if (command === 'verify-public') await verifyPublic();
else throw new Error('usage: node scripts/release-guard.mjs <validate|prepare|verify-public>');

import { execFileSync } from 'node:child_process';
import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, fetchJson, readJson, writeJsonAtomic } from './lib.mjs';
import { updateDashboardLending } from './lending-dashboard.mjs';
import { updateDashboardTokenizedFromGateway } from './tokenized-dashboard.mjs';

const TOKENIZED_GATEWAY_URL = process.env.TOKENIZED_GATEWAY_URL || 'http://127.0.0.1:43140/api/materialized/avalanche/tokenized-assets';

// Share the ecosystem collector lock: no lost updates from concurrent writers.
const lockFile = path.join(ROOT, 'state/locks/collect.lock');
await mkdir(path.dirname(lockFile), { recursive: true });
let lock;
try { lock = await open(lockFile, 'wx'); }
catch (error) { if (error.code === 'EEXIST') { console.log('lending refresh: ecosystem collector active; deferred to next scheduled run'); process.exit(0); } throw error; }
try {
  await lock.writeFile(`${process.pid}\n`); await lock.close();
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/collect-lending.mjs')], { cwd: ROOT, env: process.env, stdio: 'inherit', timeout: 60_000 });
  const dashboard = await readJson(path.join(ROOT, 'state/dashboard.json'));
  const metrics = await readJson(path.join(ROOT, 'state/lending-metrics.json'));
  const reference = await readJson(path.join(ROOT, 'state/lending-reference.json'));
  if (!dashboard?.schema || !metrics?.schema) throw new Error('refusing lending update without an existing ecosystem dashboard and normalized lending snapshot');
  let next = updateDashboardLending(dashboard, metrics, reference);
  const tokenized = await fetchJson(TOKENIZED_GATEWAY_URL, { timeoutMs: Math.max(1_000, Number(process.env.TOKENIZED_CONSUMER_TIMEOUT_MS || 10_000)), retries: 0 });
  if (tokenized.ok) {
    next = updateDashboardTokenizedFromGateway(next, tokenized.data);
  } else {
    console.error(`minute tokenized consumer unavailable; retaining prior dashboard section: ${tokenized.error || 'unknown error'}`);
  }
  next.quality.metricCatalog = await readJson(path.join(ROOT, 'config/metric-catalog.json'), next.quality.metricCatalog);
  next.quality.protocolRegistry = await readJson(path.join(ROOT, 'config/protocol-registry.json'), next.quality.protocolRegistry);
  await writeJsonAtomic(path.join(ROOT, 'state/dashboard.json'), next);
  await writeJsonAtomic(path.join(ROOT, 'public/data/dashboard.json'), next);
  console.log(`minute dashboard refreshed: lending ${next.lending.protocols.length} families / ${metrics.markets?.rows?.length || 0} source rows; tokenized Gateway ${tokenized.ok ? next.tokenizedAssets.generatedAt : 'retained'}; only state/ and public/data/ written`);
} finally { await unlink(lockFile).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }

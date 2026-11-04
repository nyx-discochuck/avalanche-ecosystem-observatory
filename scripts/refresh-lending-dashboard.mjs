import { publishSnapshotBundle, readPublishedSnapshot } from './snapshot-bundle.mjs';
import { refreshDashboardTokenized } from './tokenized-publisher.mjs';
import { execFileSync } from 'node:child_process';
import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, readJson, writeJsonAtomic } from './lib.mjs';
import { updateDashboardLending } from './lending-dashboard.mjs';

// Share the ecosystem collector lock: no lost updates from concurrent writers.
const lockFile = path.join(ROOT, 'state/locks/collect.lock');
await mkdir(path.dirname(lockFile), { recursive: true });
let lock;
try { lock = await open(lockFile, 'wx'); }
catch (error) { if (error.code === 'EEXIST') { console.log('lending refresh: ecosystem collector active; deferred to next scheduled run'); process.exit(0); } throw error; }
try {
  await lock.writeFile(`${process.pid}\n`); await lock.close();
  try { execFileSync(process.execPath, [path.join(ROOT, 'scripts/collect-lending.mjs')], { cwd: ROOT, env: process.env, stdio: 'inherit', timeout: 60_000, killSignal:'SIGKILL' }); } catch(error) { console.error('Lending child failed; retaining last-good observations:',error.message); }
  const dashboard = await readPublishedSnapshot(ROOT, 'dashboard.json');
  const metrics = await readJson(path.join(ROOT, 'state/lending-metrics.json'));
  const reference = await readJson(path.join(ROOT, 'state/lending-reference.json'));
  if (!dashboard?.schema || !metrics?.schema) throw new Error('refusing lending update without an existing ecosystem dashboard and normalized lending snapshot');
  const next = await refreshDashboardTokenized(updateDashboardLending(dashboard, metrics, reference));
  next.quality.metricCatalog = await readJson(path.join(ROOT, 'config/metric-catalog.json'), next.quality.metricCatalog);
  next.quality.protocolRegistry = await readJson(path.join(ROOT, 'config/protocol-registry.json'), next.quality.protocolRegistry);
  await writeJsonAtomic(path.join(ROOT, 'state/dashboard.json'), next);
  await publishSnapshotBundle(ROOT, {'dashboard.json':next,'blockspace.json':await readPublishedSnapshot(ROOT,'blockspace.json'),'tokenized-activity.json':await readPublishedSnapshot(ROOT,'tokenized-activity.json')});
  console.log(`lending dashboard refreshed: ${next.lending.protocols.length} families, ${metrics.markets?.rows?.length || 0} source rows, observed ${next.lending.observedAt}; unrelated ecosystem sections retained`);
} finally { await unlink(lockFile).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }

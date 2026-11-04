import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const names = ['dashboard.json', 'blockspace.json', 'tokenized-activity.json'];
const digest = (body) => createHash('sha256').update(body).digest('hex');

export async function readPublishedSnapshot(root, name, fallback) {
  if (!names.includes(name)) throw new Error('Unknown published snapshot');
  const base = path.join(root, 'state/published');
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(base, 'current.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (typeof fallback === 'function') return fallback();
    return JSON.parse(await fs.readFile(path.join(root, 'state', name), 'utf8'));
  }
  if (!/^[0-9T-Z-]+-[0-9a-f-]{36}$/.test(manifest.id || '') || manifest.schema !== 'ecosystem-snapshot-bundle/v1' || !manifest.files?.[name]) throw new Error('Invalid published bundle pointer');
  const body = await fs.readFile(path.join(base, 'releases', manifest.id, name));
  if (digest(body) !== manifest.files[name]) throw new Error('Published snapshot digest mismatch');
  return JSON.parse(body);
}

export async function publishSnapshotBundle(root, supplied = null, { beforeSwitch, afterSwitch } = {}) {
  const payloads = supplied || Object.fromEntries(await Promise.all(names.map(async name => [name, JSON.parse(await fs.readFile(path.join(root, 'state', name), 'utf8'))])));
  for (const name of names) if (!payloads[name]?.schema || !payloads[name]?.generatedAt) throw new Error(`Invalid bundle member ${name}`);
  if (payloads['dashboard.json'].tokenizedAssets?.activityStatus?.generatedAt !== payloads['tokenized-activity.json'].generatedAt) throw new Error('Incoherent tokenized activity snapshot');
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
  const base = path.join(root, 'state/published');
  const directory = path.join(base, 'releases', id);
  await fs.mkdir(directory, { recursive: true });
  const files = {};
  for (const name of names) {
    const body = JSON.stringify(payloads[name], null, 2) + '\n';
    await fs.writeFile(path.join(directory, name), body, { mode: 0o640 });
    files[name] = digest(body);
  }
  const manifest = { schema: 'ecosystem-snapshot-bundle/v1', id, committedAt: new Date().toISOString(), files };
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (beforeSwitch) await beforeSwitch(manifest);
  const pointer = path.join(base, `.current-${randomUUID()}.tmp`);
  await fs.writeFile(pointer, JSON.stringify(manifest) + '\n', { mode: 0o640 });
  await fs.rename(pointer, path.join(base, 'current.json'));
  if (afterSwitch) await afterSwitch(manifest);
  // The API and /data routes read only the committed pointer. These files are
  // compatibility/build inputs; updating them cannot expose a mixed HTTP bundle.
  for (const name of names) {
    await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
    const target = path.join(root, 'public/data', name);
    const temp = `${target}.${process.pid}.tmp`;
    await fs.copyFile(path.join(directory, name), temp); await fs.rename(temp, target);
  }
  // Bounded local retention; every currently visible bundle and four rollback
  // bundles remain intact. A failed pre-switch directory is never visible.
  const older = (await fs.readdir(path.join(base, 'releases'))).filter(n => n !== id).sort().reverse().slice(4);
  for (const name of older) await fs.rm(path.join(base, 'releases', name), { recursive: true, force: true });
  return manifest;
}

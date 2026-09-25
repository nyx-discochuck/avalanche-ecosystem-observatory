import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, readJson } from './lib.mjs';

const names = ['blockspace.json', 'dashboard.json', 'tokenized-activity.json'];
const sourceDirectory = path.join(ROOT, 'state');
const destinationDirectory = path.join(ROOT, 'public', 'data');
const stagingDirectory = path.join(ROOT, 'public', `.data-stage-${process.pid}-${Date.now()}`);
const backupDirectory = path.join(ROOT, 'public', `.data-backup-${process.pid}-${Date.now()}`);

const payloads = Object.fromEntries(await Promise.all(names.map(async (name) => {
  const source = path.join(sourceDirectory, name);
  const payload = await readJson(source);
  if (!payload?.schema || !payload?.generatedAt) throw new Error(`${source} is not a successful collector snapshot`);
  return [name, payload];
})));
if (payloads['dashboard.json'].tokenizedAssets?.activityStatus?.generatedAt !== payloads['tokenized-activity.json'].generatedAt) {
  throw new Error('dashboard and tokenized activity timestamps are incoherent');
}

await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(stagingDirectory, { recursive: true });
try {
  for (const name of names) await copyFile(path.join(sourceDirectory, name), path.join(stagingDirectory, name));
  await rename(destinationDirectory, backupDirectory);
  try {
    await rename(stagingDirectory, destinationDirectory);
  } catch (error) {
    await rename(backupDirectory, destinationDirectory);
    throw error;
  }
  await rm(backupDirectory, { recursive: true, force: true });
} catch (error) {
  await rm(stagingDirectory, { recursive: true, force: true });
  throw error;
}

console.log(`atomically published ${names.length} coherent release snapshots to ${destinationDirectory}`);

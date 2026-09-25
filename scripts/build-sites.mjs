import { execFileSync } from 'node:child_process';
import { copyFile, cp, mkdir, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const output = path.join(ROOT, 'dist');
const staging = path.join(ROOT, '.sites-client-build');
const client = path.join(output, 'client');

await rm(staging, { recursive: true, force: true });
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  cwd: ROOT,
  env: { ...process.env, VITE_BASE: '/' },
  stdio: 'inherit',
});
await rename(output, staging);
await mkdir(path.join(output, 'server'), { recursive: true });
await mkdir(path.join(output, '.openai'), { recursive: true });
await cp(staging, client, { recursive: true });
await copyFile(path.join(ROOT, 'deploy', 'sites', 'worker.mjs'), path.join(output, 'server', 'index.js'));
await copyFile(path.join(ROOT, '.openai', 'hosting.json'), path.join(output, '.openai', 'hosting.json'));
await copyFile(path.join(ROOT, 'config', 'metric-catalog.json'), path.join(client, 'data', 'metric-catalog.json'));
await copyFile(path.join(ROOT, 'config', 'protocol-registry.json'), path.join(client, 'data', 'protocol-registry.json'));
await copyFile(path.join(ROOT, 'config', 'sources.json'), path.join(client, 'data', 'sources.json'));
await rm(staging, { recursive: true, force: true });

console.log(`prepared Sites artifact in ${output}`);

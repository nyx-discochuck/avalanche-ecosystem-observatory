import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { runBoundedChild, runBoundedChildrenSettled } from '../scripts/bounded-child.mjs';

const scratch = await mkdtemp(path.join(tmpdir(), 'bounded-child-'));
after(() => rm(scratch, { recursive: true, force: true }));

test('bounded child kills and reaps a stuck derivation', async () => {
  const fixture = path.join(scratch, 'stuck.mjs');
  const pidFile = path.join(scratch, 'pid');
  await writeFile(fixture, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`);
  const started = Date.now();
  assert.throws(() => runBoundedChild(fixture, { cwd: scratch, timeoutMs: 500, stdio: 'ignore' }), (error) => error?.code === 'ETIMEDOUT');
  assert.ok(Date.now() - started < 2_000);
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), (error) => error?.code === 'ESRCH');
});

test('one timed-out derived child does not block an unrelated child result', async () => {
  const stuck = path.join(scratch, 'parallel-stuck.mjs');
  const fast = path.join(scratch, 'parallel-fast.mjs');
  await writeFile(stuck, 'setInterval(() => {}, 1000);\n');
  await writeFile(fast, 'console.log("published");\n');
  const results = await runBoundedChildrenSettled([
    { name: 'stuck', file: stuck, options: { cwd: scratch, timeoutMs: 250 } },
    { name: 'fast', file: fast, options: { cwd: scratch, timeoutMs: 2_000 } },
  ]);
  assert.equal(results.find((row) => row.name === 'stuck').status, 'rejected');
  assert.equal(results.find((row) => row.name === 'fast').status, 'fulfilled');
  assert.match(results.find((row) => row.name === 'fast').value.stdout, /published/);
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { runBoundedChild } from '../scripts/bounded-child.mjs';

const scratch = await mkdtemp(path.join(tmpdir(), 'bounded-child-'));
after(() => rm(scratch, { recursive: true, force: true }));

test('bounded child kills and reaps a stuck derivation', () => {
  const fixture = path.join(scratch, 'stuck.mjs');
  const pidFile = path.join(scratch, 'pid');
  return writeFile(fixture, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`).then(() => {
    const started = Date.now();
    assert.throws(() => runBoundedChild(fixture, { cwd: scratch, timeoutMs: 150, stdio: 'ignore' }), (error) => error?.code === 'ETIMEDOUT');
    assert.ok(Date.now() - started < 2_000);
    return readFile(pidFile, 'utf8').then((value) => {
      const pid = Number(value);
      assert.throws(() => process.kill(pid, 0), (error) => error?.code === 'ESRCH');
    });
  });
});

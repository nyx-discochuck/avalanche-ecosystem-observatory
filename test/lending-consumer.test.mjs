import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('HTTP200 malformed canonical snapshot preserves last-good values and original observation time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lending-consumer-test-'));
  const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"schema":"wrong","markets":[]}'); });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await mkdir(join(root, 'scripts')); await mkdir(join(root, 'state'));
    for (const name of ['collect-lending.mjs', 'lib.mjs', 'lending-materialized.mjs', 'lending-metrics.mjs']) await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(root, 'scripts', name));
    const old = { schema: 'couchdicks.avalanche.lending-metrics.v4', observedAt: '2026-09-16T00:00:00Z', aggregates: { suppliedUsd: 123 }, markets: { rows: [{ id: 'retained' }] } };
    await writeFile(join(root, 'state/lending-metrics.json'), JSON.stringify(old));
    await promisify(execFile)(process.execPath, [join(root, 'scripts/collect-lending.mjs')], { env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', LENDING_MATERIALIZED_URL: `http://127.0.0.1:${server.address().port}` } });
    const actual = JSON.parse(await readFile(join(root, 'state/lending-metrics.json'), 'utf8'));
    assert.deepEqual(actual.aggregates, old.aggregates);
    assert.equal(actual.markets.rows[0].id, old.markets.rows[0].id);
    assert.equal(actual.markets.state, 'stale');
    assert.equal(actual.markets.rows[0].retainedLastGood, true);
    assert.equal(actual.observedAt, old.observedAt);
    assert.equal(actual.acquisition.retainedLastGood, true);
    assert.match(actual.acquisition.error, /invalid canonical/);
    assert.equal(actual.sourceHealth.canonicalMaterializer.ok, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

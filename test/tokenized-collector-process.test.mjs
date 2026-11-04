import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { DuckDBInstance } from '@duckdb/node-api';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), 'tokenized-collector-'));
after(() => rm(scratch, { recursive: true, force: true }));

test('tokenized derivation closes DuckDB and exits after atomic writes', { timeout: 15_000 }, async () => {
  const archive = path.join(scratch, 'archive');
  const parquet = path.join(archive, '2026-09-17.events.parquet');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(archive, { recursive: true }));
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  try {
    await connection.run(`CREATE TABLE events(address VARCHAR, topic0 VARCHAR, topic1 VARCHAR, topic2 VARCHAR, data VARCHAR)`);
    await connection.run(`INSERT INTO events VALUES (
      '0x53fc82f14f009009b440a706e31c9021e1196a2f',
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x0000000000000000000000001111111111111111111111111111111111111111',
      '0x01'
    )`);
    await connection.run(`COPY events TO '${parquet.replaceAll("'", "''")}' (FORMAT PARQUET)`);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  const output = path.join(scratch, 'activity.json');
  const checkpoint = path.join(scratch, 'checkpoint.json');
  const started = Date.now();
  const result = await execFileAsync(process.execPath, [path.join(root, 'scripts', 'collect-tokenized.mjs')], {
    cwd: root,
    timeout: 8_000,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      AVACACHE_DIR: archive,
      COLLECT_LOOKBACK_DAYS: '7',
      TOKENIZED_OUTPUT_FILE: output,
      TOKENIZED_CHECKPOINT_FILE: checkpoint,
    },
  });
  assert.match(result.stdout, /derived 4 token activity rows/);
  assert.ok(Date.now() - started < 8_000);
  const payload = JSON.parse(await readFile(output, 'utf8'));
  const savedCheckpoint = JSON.parse(await readFile(checkpoint, 'utf8'));
  assert.equal(payload.daily.length, 4);
  assert.equal(payload.coverage.end, '2026-09-17');
  assert.equal(savedCheckpoint.completedAt, payload.generatedAt);
});

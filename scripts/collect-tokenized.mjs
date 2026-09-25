import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { DuckDBInstance, DuckDBScalarFunction, DOUBLE, VARCHAR } from '@duckdb/node-api';
import { ROOT, readJson, writeJsonAtomic } from './lib.mjs';
import { materializeCoveredActivityRows } from './tokenized-dashboard.mjs';

const archiveDir = path.resolve(process.env.AVACACHE_DIR || path.join(ROOT, 'data', 'avax-data-parquet'));
const lookbackDays = Math.max(7, Number(process.env.COLLECT_LOOKBACK_DAYS || 30));
const outputFile = process.env.TOKENIZED_OUTPUT_FILE || path.join(ROOT, 'state', 'tokenized-activity.json');
const checkpointFile = process.env.TOKENIZED_CHECKPOINT_FILE || path.join(ROOT, 'state', 'tokenized-checkpoint.json');
const ACTIVITY_SCHEMA = 'couchdicks.avalanche.tokenized-activity.v2';
const ACTIVITY_IMPLEMENTATION_VERSION = 'full-covered-day-matrix/raw-decimal-strings/v2';
const registry = await readJson(path.join(ROOT, 'config', 'protocol-registry.json'), {});
const tokens = (registry.protocols || []).flatMap((protocol) => (protocol.contracts || [])
  .filter((contract) => contract.role === 'Token')
  .map((contract) => ({
    id: protocol.id,
    name: protocol.name,
    address: contract.address.toLowerCase(),
    category: protocol.category,
  })));

function hexToDouble(value) {
  if (typeof value !== 'string' || !value.startsWith('0x')) return null;
  try {
    return Number(BigInt(value));
  } catch {
    return null;
  }
}

function filesSql(files) {
  return `[${files.map((file) => `'${file.replaceAll("'", "''")}'`).join(',')}]`;
}

const names = await readdir(archiveDir);
const dates = names
  .filter((name) => /^\d{4}-\d{2}-\d{2}\.events\.parquet$/.test(name))
  .map((name) => name.slice(0, 10))
  .sort()
  .slice(-lookbackDays);
if (!dates.length) throw new Error(`no event parquet files found in ${archiveDir}`);

const eventFiles = dates.map((date) => path.join(archiveDir, `${date}.events.parquet`));
const sourceMetadata = await Promise.all(eventFiles.map(async (file) => {
  const info = await stat(file);
  return `${path.basename(file)}:${info.size}:${Math.trunc(info.mtimeMs)}`;
}));
const fingerprint = `${ACTIVITY_IMPLEMENTATION_VERSION}:${sourceMetadata.join(',')}:${tokens.map((token) => token.address).sort().join(',')}`;
const previous = await readJson(checkpointFile, {});
const existing = await readJson(outputFile, null);
const expectedKeys = new Set(dates.flatMap((date) => tokens.map((token) => `${date}:${token.address}`)));
const existingKeys = new Set((existing?.daily || []).map((row) => `${row.date}:${row.address?.toLowerCase()}`));
const existingIsFullMatrix = existing?.schema === ACTIVITY_SCHEMA && existingKeys.size === expectedKeys.size && [...expectedKeys].every((key) => existingKeys.has(key));
if (previous.fingerprint === fingerprint && existingIsFullMatrix) {
  console.log(`tokenized activity current through ${dates.at(-1)}; verified ${existingKeys.size}-row covered-day matrix; derivation skipped`);
  process.exit(0);
}

const instance = await DuckDBInstance.create(':memory:');
const connection = await instance.connect();
let sparseRows;
try {
  connection.registerScalarFunction(DuckDBScalarFunction.create({
    name: 'hex_double',
    returnType: DOUBLE,
    parameterTypes: [VARCHAR],
    mainFunction: (_info, input, output) => {
      const vector = input.getColumnVector(0);
      for (let index = 0; index < input.rowCount; index += 1) output.setItem(index, hexToDouble(vector.getItem(index)));
      output.flush();
    },
  }));

  const addresses = tokens.map((token) => `'${token.address}'`).join(',');
  const files = eventFiles;
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const zeroTopic = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const reader = await connection.runAndReadAll(`
  SELECT
    regexp_extract(filename, '([0-9]{4}-[0-9]{2}-[0-9]{2})\\.events\\.parquet', 1) AS date,
    lower(address) AS address,
    count(*)::BIGINT AS transfers,
    count(*) FILTER (WHERE topic1 = '${zeroTopic}')::BIGINT AS mint_events,
    count(*) FILTER (WHERE topic2 = '${zeroTopic}')::BIGINT AS burn_events,
    sum(CASE WHEN topic1 = '${zeroTopic}' THEN hex_double(data) ELSE 0 END) AS minted_raw,
    sum(CASE WHEN topic2 = '${zeroTopic}' THEN hex_double(data) ELSE 0 END) AS burned_raw,
    count(DISTINCT lower('0x' || right(topic1, 40))) +
      count(DISTINCT lower('0x' || right(topic2, 40))) AS participant_sides
  FROM read_parquet(${filesSql(files)}, filename=true)
  WHERE lower(address) IN (${addresses || "''"})
    AND topic0 = '${transferTopic}'
  GROUP BY 1, 2
  ORDER BY 1, 2
`);
  sparseRows = reader.getRowObjectsJS().map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]),
  ));
} finally {
  connection.closeSync();
  instance.closeSync();
}

// Every selected parquet file is a fully covered archive day. Emit an explicit
// zero for each exact contract only in that covered date set; absence outside
// coverage remains unavailable rather than becoming an invented zero.
const rows = materializeCoveredActivityRows(dates, tokens, sparseRows);
const tokenByAddress = new Map(tokens.map((token) => [token.address, token]));
const payload = {
  schema: ACTIVITY_SCHEMA,
  generatedAt: new Date().toISOString(),
  source: 'local-avacache-parquet',
  coverage: { start: dates[0], end: dates.at(-1), days: dates.length, status: 'fully-covered-archive-days', semantics: 'Explicit zero rows exist only for every tracked contract on each fully covered archive day; dates outside this interval are unavailable.' },
  note: 'Mint and burn amounts are raw token units until onchain decimals are applied by the main collector. Historical USD values are withheld unless an observation-date valuation exists. Address counts are contract-address counts, not unique investors.',
  tokens,
  daily: rows.map((row) => ({ ...row, minted_raw: String(row.minted_raw ?? 0), burned_raw: String(row.burned_raw ?? 0), tokenId: tokenByAddress.get(row.address)?.id || null })),
};
await writeJsonAtomic(outputFile, payload);
await writeJsonAtomic(checkpointFile, { fingerprint, implementationVersion: ACTIVITY_IMPLEMENTATION_VERSION, schema: ACTIVITY_SCHEMA, matrixRows: rows.length, completedAt: payload.generatedAt, coverage: payload.coverage, sourceFiles: sourceMetadata });
console.log(`derived ${rows.length} token activity rows through ${payload.coverage.end}`);

// @duckdb/node-api can retain native handles after a scalar UDF has completed,
// even after closeSync(). All durable writes above are awaited; explicitly exit
// only after stdout drains so a completed child can never wedge its parent.
await new Promise((resolve) => process.stdout.write('', resolve));
process.exit(0);

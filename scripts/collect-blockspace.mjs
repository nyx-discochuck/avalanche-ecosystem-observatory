import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { DuckDBInstance, DuckDBScalarFunction, DOUBLE, VARCHAR } from '@duckdb/node-api';
import { ROOT, readJson, writeJsonAtomic } from './lib.mjs';
import { blockspaceCoverage, extractBlockspaceDaily, mergeBlockspaceDaily } from './blockspace-history.mjs';

const archiveDir = path.resolve(process.env.AVACACHE_DIR || path.join(ROOT, 'data', 'avax-data-parquet'));
const outputFile = process.env.BLOCKSPACE_OUTPUT_FILE || path.join(ROOT, 'state', 'blockspace.json');
const checkpointFile = process.env.BLOCKSPACE_CHECKPOINT_FILE || path.join(ROOT, 'state', 'blockspace-checkpoint.json');
const lookbackDays = Math.max(7, Number(process.env.COLLECT_LOOKBACK_DAYS || 30));

function hexToDouble(value) {
  if (typeof value !== 'string' || !value.startsWith('0x')) return null;
  try {
    return Number(BigInt(value));
  } catch {
    return null;
  }
}

function fileList(files) {
  return `[${files.map((file) => `'${file.replaceAll("'", "''")}'`).join(',')}]`;
}

async function query(connection, sql) {
  const reader = await connection.runAndReadAll(sql);
  return reader.getRowObjectsJS().map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]),
  ));
}

const names = await readdir(archiveDir);
const completeDates = [...new Set(
  names
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.(blocks|txs)\.parquet$/.test(name))
    .map((name) => name.slice(0, 10)),
)].filter((date) => names.includes(`${date}.blocks.parquet`) && names.includes(`${date}.txs.parquet`))
  .sort()
  .slice(-lookbackDays);

if (!completeDates.length) throw new Error(`no complete daily parquet pairs found in ${archiveDir}`);

const txFiles = completeDates.map((date) => path.join(archiveDir, `${date}.txs.parquet`));
const blockFiles = completeDates.map((date) => path.join(archiveDir, `${date}.blocks.parquet`));
const previous = await readJson(checkpointFile, {});
const sourceMetadata = await Promise.all([...blockFiles, ...txFiles].map(async (file) => {
  const info = await stat(file);
  return `${path.basename(file)}:${info.size}:${Math.trunc(info.mtimeMs)}`;
}));
const fingerprint = sourceMetadata.join(',');
const historySeedFiles = [
  outputFile,
  path.join(ROOT, 'state', 'dashboard.json'),
  path.join(ROOT, 'public', 'data', 'dashboard.json'),
  ...(process.env.BLOCKSPACE_HISTORY_SEED || '').split(',').map((value) => value.trim()).filter(Boolean),
];
const historyCandidates = await Promise.all(historySeedFiles.map((file) => readJson(file, null)));
const previousDaily = mergeBlockspaceDaily(historyCandidates.flatMap(extractBlockspaceDaily), []);
const existingOutput = await readJson(outputFile, null);
const existingDays = extractBlockspaceDaily(existingOutput).length;
if (previous.fingerprint === fingerprint && previous.completedAt && existingOutput && existingDays >= previousDaily.length) {
  console.log(`blockspace current through ${completeDates.at(-1)}; ${existingDays} preserved days already published (${completeDates.length} retained-source days)`);
  process.exit(0);
}

const instance = await DuckDBInstance.create(':memory:');
const connection = await instance.connect();
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

const txDaily = await query(connection, `
  SELECT
    regexp_extract(filename, '([0-9]{4}-[0-9]{2}-[0-9]{2})\\.txs\\.parquet', 1) AS date,
    count(*)::BIGINT AS transactions,
    count(DISTINCT lower(from_address))::BIGINT AS active_addresses,
    count(*) FILTER (WHERE to_address IS NULL OR to_address = '')::BIGINT AS contract_creations,
    count(*) FILTER (WHERE status = 0)::BIGINT AS failed_transactions,
    avg(hex_double(effective_gas_price)) / 1e9 AS average_gas_price_gwei,
    avg(gas_used * hex_double(effective_gas_price)) / 1e18 AS average_fee_avax,
    median(gas_used * hex_double(effective_gas_price)) / 1e18 AS median_fee_avax,
    sum(gas_used * hex_double(effective_gas_price)) / 1e18 AS fees_burned_avax,
    sum(gas_used)::DOUBLE AS gas_used
  FROM read_parquet(${fileList(txFiles)}, filename=true)
  GROUP BY 1
  ORDER BY 1
`);

const blockDaily = await query(connection, `
  SELECT
    regexp_extract(filename, '([0-9]{4}-[0-9]{2}-[0-9]{2})\\.blocks\\.parquet', 1) AS date,
    count(*)::BIGINT AS blocks,
    min(number)::BIGINT AS first_block,
    max(number)::BIGINT AS last_block,
    avg(gas_used::DOUBLE / nullif(gas_limit, 0)) * 100 AS average_block_utilization_pct,
    avg(hex_double(base_fee_per_gas)) / 1e9 AS average_base_fee_gwei,
    min(timestamp)::BIGINT AS first_timestamp,
    max(timestamp)::BIGINT AS last_timestamp
  FROM read_parquet(${fileList(blockFiles)}, filename=true)
  GROUP BY 1
  ORDER BY 1
`);

const topContracts = await query(connection, `
  SELECT
    lower(to_address) AS address,
    sum(gas_used)::DOUBLE AS gas_used,
    sum(gas_used * hex_double(effective_gas_price)) / 1e18 AS fees_burned_avax,
    count(*)::BIGINT AS transactions,
    count(DISTINCT lower(from_address))::BIGINT AS unique_senders,
    count(DISTINCT regexp_extract(filename, '([0-9]{4}-[0-9]{2}-[0-9]{2})\\.txs\\.parquet', 1))::BIGINT AS active_days
  FROM read_parquet(${fileList(txFiles)}, filename=true)
  WHERE to_address IS NOT NULL AND to_address <> ''
  GROUP BY 1
  ORDER BY gas_used DESC
  LIMIT 100
`);
connection.closeSync();
instance.closeSync();

const byDate = new Map(blockDaily.map((row) => [row.date, row]));
const daily = txDaily.map((row) => {
  const block = byDate.get(row.date) || {};
  const seconds = 86_400;
  return {
    ...row,
    ...block,
    throughput_tps: row.transactions / seconds,
    throughput_mgas_s: row.gas_used / seconds / 1_000_000,
    failure_rate_pct: row.transactions ? (row.failed_transactions / row.transactions) * 100 : null,
    partial: false,
  };
});

const mergedDaily = mergeBlockspaceDaily(previousDaily, daily);
const coverage = blockspaceCoverage(mergedDaily, { rederivedDates: completeDates });
const payload = {
  schema: 'couchdicks.avalanche.blockspace.v1',
  generatedAt: new Date().toISOString(),
  source: 'local-avacache-parquet',
  coverage: {
    ...coverage,
    sourceWindow: { start: completeDates[0], end: completeDates.at(-1), days: completeDates.length },
    retentionPolicy: 'Previously derived complete UTC days are retained; currently available parquet days replace matching dates.',
  },
  definitions: {
    activeAddresses: 'Distinct transaction senders per UTC day.',
    contractCreations: 'Top-level transactions without a destination; internal CREATE/CREATE2 calls excluded.',
    fees: 'Receipt gas used multiplied by effective gas price. Avalanche C-Chain burns transaction fees.',
    throughput: 'Daily transaction or gas total divided by 86,400 seconds; not peak throughput.',
  },
  daily: mergedDaily,
  topContracts,
  topContractsCoverage: { start: completeDates[0], end: completeDates.at(-1), days: completeDates.length, scope: 'currently retained parquet source window only' },
};

await writeJsonAtomic(outputFile, payload);
await writeJsonAtomic(checkpointFile, {
  fingerprint,
  completedAt: payload.generatedAt,
  coverage: payload.coverage,
  sourceFiles: sourceMetadata,
});
console.log(`derived ${daily.length} source-window rows, published ${mergedDaily.length} preserved daily rows, and ${topContracts.length} retained-window contracts through ${payload.coverage.end}`);

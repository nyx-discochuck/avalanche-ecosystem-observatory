import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { ROOT, readJson, writeJsonAtomic } from './lib.mjs';
import { materializeCoveredActivityRows } from './tokenized-dashboard.mjs';

const archiveDir = process.env.AVACACHE_DIR || '/home/openclaw/.openclaw/workspace/archive/avax-data-parquet';
const lookbackDays = Math.max(7, Number(process.env.COLLECT_LOOKBACK_DAYS || 30));
const outputFile = process.env.TOKENIZED_OUTPUT_FILE || path.join(ROOT, 'state', 'tokenized-activity.json');
const checkpointFile = process.env.TOKENIZED_CHECKPOINT_FILE || path.join(ROOT, 'state', 'tokenized-checkpoint.json');
const registry = await readJson(path.join(ROOT, 'config', 'protocol-registry.json'), {});
const tokens = (registry.protocols || []).flatMap((protocol) => (protocol.contracts || [])
  .filter((contract) => contract.role === 'Token')
  .map((contract) => ({
    id: protocol.id,
    name: protocol.name,
    address: contract.address.toLowerCase(),
    category: protocol.category,
  })));

function filesSql(files) {
  return `[${files.map((file) => `'${file.replaceAll("'", "''")}'`).join(',')}]`;
}

const names = await readdir(archiveDir);
const blockspace = await readJson(path.join(ROOT, 'state', 'blockspace.json'), {});
const verifiedDates = new Set((blockspace.daily || []).filter(row => row.partial === false && row.blocks === row.last_block - row.first_block + 1).map(row => row.date));
const dates = names
  .filter((name) => /^\d{4}-\d{2}-\d{2}\.events\.parquet$/.test(name))
  .map((name) => name.slice(0, 10))
  .filter(date => verifiedDates.has(date) && date < new Date().toISOString().slice(0,10))
  .sort()
  .slice(-lookbackDays);
if (!dates.length) throw new Error(`no event parquet files found in ${archiveDir}`);

const eventFiles = dates.map((date) => path.join(archiveDir, `${date}.events.parquet`));
const sourceMetadata = await Promise.all(eventFiles.map(async (file) => {
  const info = await stat(file);
  return `${path.basename(file)}:${info.size}:${Math.trunc(info.mtimeMs)}`;
}));
const fingerprint = `exact-zero-matrix-v2:${sourceMetadata.join(',')}:${tokens.map((token) => token.address).sort().join(',')}`;
const previous = await readJson(checkpointFile, {});
if (previous.fingerprint === fingerprint && await readJson(outputFile)) {
  console.log(`tokenized activity current through ${dates.at(-1)}; derivation skipped`);
  process.exit(0);
}

const instance = await DuckDBInstance.create(':memory:');
const connection = await instance.connect();
let sparseRows;
try {
  const addresses = tokens.map(token => `'${token.address}'`).join(',');
  const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const zero = '0x' + '0'.repeat(64);
  const reader = await connection.runAndReadAll(`SELECT regexp_extract(filename, '([0-9]{4}-[0-9]{2}-[0-9]{2})\\.events\\.parquet', 1) AS date, lower(address) AS address, topic1, topic2, data FROM read_parquet(${filesSql(eventFiles)}, filename=true) WHERE lower(address) IN (${addresses}) AND topic0 = '${topic}'`);
  const groups = new Map();
  for (const e of reader.getRowObjectsJS()) {
    const key = `${e.date}:${e.address}`;
    const row = groups.get(key) || {date:e.date,address:e.address,transfers:0,mint_events:0,burn_events:0,minted:0n,burned:0n,senders:new Set(),recipients:new Set()};
    row.transfers++; row.senders.add(e.topic1); row.recipients.add(e.topic2);
    const amount=BigInt(e.data);
    if(e.topic1===zero){row.mint_events++;row.minted+=amount;}
    if(e.topic2===zero){row.burn_events++;row.burned+=amount;}
    groups.set(key,row);
  }
  sparseRows=[...groups.values()].map(({minted,burned,senders,recipients,...row})=>({...row,minted_raw:minted.toString(),burned_raw:burned.toString(),participant_sides:senders.size+recipients.size}));

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
  schema: 'couchdicks.avalanche.tokenized-activity.v1',
  generatedAt: new Date().toISOString(),
  source: 'local-avacache-parquet',
  coverage: { start: dates[0], end: dates.at(-1), days: dates.length, status: 'fully-covered-archive-days', dates, completeDaysOnly: true, sourceFiles: sourceMetadata, semantics: 'Explicit zero rows exist only for every tracked contract on each fully covered archive day; dates outside this interval are unavailable.' },
  note: 'Mint and burn amounts are raw token units until onchain decimals are applied by the main collector. Historical USD values are withheld unless an observation-date valuation exists. Address counts are contract-address counts, not unique investors.',
  tokens,
  daily: rows.map((row) => ({ ...row, tokenId: tokenByAddress.get(row.address)?.id || null })),
};
await writeJsonAtomic(outputFile, payload);
await writeJsonAtomic(checkpointFile, { fingerprint, completedAt: payload.generatedAt, coverage: payload.coverage, sourceFiles: sourceMetadata });
console.log(`derived ${rows.length} token activity rows through ${payload.coverage.end}`);

// @duckdb/node-api can retain native handles after a scalar UDF has completed,
// even after closeSync(). All durable writes above are awaited; explicitly exit
// only after stdout drains so a completed child can never wedge its parent.
await new Promise((resolve) => process.stdout.write('', resolve));
process.exit(0);

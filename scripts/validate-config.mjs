import path from 'node:path';
import { ROOT, readJson } from './lib.mjs';

const files = [
  ['sources', path.join(ROOT, 'config', 'sources.json')],
  ['protocol registry', path.join(ROOT, 'config', 'protocol-registry.json')],
  ['metric catalog', path.join(ROOT, 'config', 'metric-catalog.json')],
];

let failed = false;
for (const [label, file] of files) {
  const value = await readJson(file);
  if (!value?.schema) {
    console.error(`${label}: missing schema`);
    failed = true;
  }
}

const registry = await readJson(files[1][1], {});
const addresses = [];
for (const protocol of registry.protocols || []) {
  if (!protocol.id || !protocol.name || !protocol.category || !protocol.source || !protocol.confidence) {
    console.error(`protocol registry: incomplete entry ${protocol.id || protocol.name || '(unnamed)'}`);
    failed = true;
  }
  for (const contract of protocol.contracts || []) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(contract.address || '')) {
      console.error(`protocol registry: invalid address ${contract.address} in ${protocol.id}`);
      failed = true;
    }
    addresses.push(contract.address.toLowerCase());
  }
}

if (new Set(addresses).size !== addresses.length) {
  console.error('protocol registry: duplicate contract address');
  failed = true;
}

const catalog = await readJson(files[2][1], {});
const ids = (catalog.metrics || []).map((metric) => metric.id);
if (new Set(ids).size !== ids.length) {
  console.error('metric catalog: duplicate metric id');
  failed = true;
}
for (const metric of catalog.metrics || []) {
  const required = ['id', 'label', 'unit', 'definition', 'formula', 'sources', 'cadence', 'coverageStart', 'confidence', 'limitations'];
  const missing = required.filter((field) => metric[field] == null);
  if (missing.length) {
    console.error(`metric catalog: ${metric.id || '(unnamed)'} missing ${missing.join(', ')}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`validated ${registry.protocols?.length || 0} protocols, ${addresses.length} contracts, and ${ids.length} metrics`);


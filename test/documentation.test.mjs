import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('AVAX Radar architecture is linked and preserves the external boundary', async () => {
  const [readme, architecture, guide] = await Promise.all([
    read('README.md'),
    read('docs/ARCHITECTURE.md'),
    read('docs/AVAX_RADAR_GATEWAY.md'),
  ]);

  assert.match(readme, /docs\/AVAX_RADAR_GATEWAY\.md/);
  assert.match(architecture, /AVAX_RADAR_GATEWAY\.md/);
  assert.match(guide, /separately operated/);
  assert.match(guide, /static\/offline path/);
  assert.match(guide, /idempotent replay/);
  assert.match(guide, /atomic rename/);
  assert.match(guide, /fail-open/);
});

test('public AVAX Radar guide excludes deployment-specific configuration', async () => {
  const guide = await read('docs/AVAX_RADAR_GATEWAY.md');

  assert.doesNotMatch(guide, /\/home\//);
  assert.doesNotMatch(guide, /DATABASE_URL\s*=/);
  assert.doesNotMatch(guide, /https?:\/\/[^\s)`]+\/ext\/bc\/C\/rpc/);
  assert.doesNotMatch(guide, /(?:api[_-]?key|secret|token)\s*=/i);
});

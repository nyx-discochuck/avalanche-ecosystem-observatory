import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { publishSnapshotBundle } from '../scripts/snapshot-bundle.mjs';

let port;
const serverFixtureFiles = ['server.mjs', 'live-pulse.mjs', 'radar-adapter.mjs', 'scripts/snapshot-bundle.mjs', 'scripts/tokenized-publisher.mjs', 'scripts/tokenized-dashboard.mjs', 'scripts/lib.mjs'];
let child;
let childOutput = '';

// Node 24 honors HTTP(S)_PROXY for fetch; keep the isolated test server on
// loopback instead of sending its requests through an environment proxy.
process.env.NO_PROXY = [...new Set([...(process.env.NO_PROXY || '').split(',').filter(Boolean), '127.0.0.1', 'localhost'])].join(',');
process.env.no_proxy = [...new Set([...(process.env.no_proxy || '').split(',').filter(Boolean), '127.0.0.1', 'localhost'])].join(',');

before(async () => {
  port = await new Promise((resolve, reject) => {
    const reservation = createServer();
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', () => {
      const selected = reservation.address().port;
      reservation.close((error) => error ? reject(error) : resolve(selected));
    });
  });
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: {
      ...process.env,
      NO_PROXY: process.env.NO_PROXY,
      no_proxy: process.env.no_proxy,
      PORT: String(port),
      HOST: '127.0.0.1',
      LIVE_PULSE_DISABLED: '1',
      AVAX_RADAR_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { childOutput += chunk; });
  child.stderr.on('data', (chunk) => { childOutput += chunk; });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`test server did not become ready${childOutput ? `: ${childOutput.trim()}` : ''}`);
});

after(() => child?.kill('SIGTERM'));

// Unlike fetch, node:http preserves encoded/raw dot segments for the server gate.
function requestRaw(pathname) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: pathname, method: 'GET', agent: false }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('health and snapshot endpoints expose cached data', async () => {
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  const dashboard = await fetch(`http://127.0.0.1:${port}/avalanche/ecosystem/api/dashboard`);
  assert.equal(dashboard.status, 200);
  const healthPayload = await health.json();
  const dashboardPayload = await dashboard.json();
  assert.equal(health.status, dashboardPayload.metadata.freshness === 'healthy' ? 200 : 207);
  const checks = dashboardPayload.quality.verification.checks;
  assert.equal(healthPayload.verificationSummary.pass, checks.filter((check) => check.status === 'pass').length);
  assert.equal(healthPayload.verificationSummary.scored, checks.filter((check) => ['pass', 'review'].includes(check.status)).length);
  assert.equal(dashboardPayload.metadata.chainId, 43114);
});

test('prefixed deep links use the SPA fallback and security headers', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/avalanche/ecosystem/verification`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('strict SPA allowlist preserves every established dashboard view in both slash forms', async () => {
  for (const route of ['overview', 'beginners', 'experts', 'governance', 'unlocks', 'staking', 'blockspace', 'economics', 'spot-trading', 'tokenized-assets', 'lending', 'verification']) {
    for (const suffix of ['', '/']) {
      const response = await fetch(`http://127.0.0.1:${port}/avalanche/ecosystem/${route}${suffix}`);
      assert.equal(response.status, 200, `${route}${suffix}`);
      assert.match(response.headers.get('content-type'), /text\/html/);
    }
  }
  const safeQuery = await fetch(`http://127.0.0.1:${port}/avalanche/ecosystem/lending?source=.env`);
  assert.equal(safeQuery.status, 200, 'query content is not part of route validation');
});

test('audience and intelligence routes expose unique indexable metadata and copy', async () => {
  const expected = new Map([
    ['beginners', ['Avalanche Ecosystem Guide for Beginners | AVAX & DeFi', 'A practical guide to the Avalanche ecosystem']],
    ['experts', ['Avalanche Ecosystem Analytics for Advanced Users', 'Avalanche ecosystem analytics for advanced users']],
    ['governance', ['Avalanche Governance & ACP Tracker', 'Avalanche governance and network-change watch']],
    ['unlocks', ['Avalanche Token Unlocks & AVAX Emissions', 'Avalanche token unlocks and emissions']],
    ['staking', ['AVAX Staking Rewards & Avalanche Validator Economics', 'AVAX staking and Avalanche validator economics']],
    ['verification', ['Avalanche Metrics Verification & Evidence Ledger', 'Avalanche metric verification and evidence ledger']],
    ['tokenized-assets', ['Avalanche Tokenized Assets, Funds & RWA Evidence', 'Verified tokenized assets issued on Avalanche']],
  ]);
  for (const [route, [title, heading]] of expected) {
    const response = await fetch(`http://127.0.0.1:${port}/avalanche/ecosystem/${route}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, new RegExp(`<title>${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(html, new RegExp(`<h1>${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`));
    assert.match(html, new RegExp(`rel="canonical" href="https://couchdicks.org/avalanche/ecosystem/${route}/"`));
    const structuredData = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1]);
    assert.equal(structuredData.url, `https://couchdicks.org/avalanche/ecosystem/${route}/`);
    assert.equal(structuredData.name, title);
  }
});

test('tokenized route canonicalizes to its trailing-slash URL', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/avalanche/ecosystem/tokenized-assets`, { redirect: 'manual' });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), '/avalanche/ecosystem/tokenized-assets/');
});

test('scoped sitemap publishes every indexable dashboard route', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/avalanche/ecosystem/sitemap.xml`);
  const xml = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/xml/);
  for (const route of ['', 'beginners/', 'experts/', 'governance/', 'unlocks/', 'staking/', 'verification/', 'tokenized-assets/']) {
    assert.match(xml, new RegExp(`<loc>https://couchdicks\\.org/avalanche/ecosystem/${route}</loc>`));
  }
});

test('unsupported methods and missing API routes fail closed', async () => {
  const post = await fetch(`http://127.0.0.1:${port}/api/dashboard`, { method: 'POST' });
  const missing = await fetch(`http://127.0.0.1:${port}/api/not-real`);
  assert.equal(post.status, 405);
  assert.equal(missing.status, 404);
});

test('private and traversal-shaped paths fail closed without SPA contents', async () => {
  const denied = ['/.env', '/.git/config', '/.release/rollback.json', '/.openai/private', '/state/dashboard.json', '/State/dashboard.json', '/package.json', '/package-lock.json',
    '/src/App.jsx', '/scripts/collect.mjs', '/reports/rollback.json', '/source-backup.tar.gz', '/state-backup.json',
    '/definitely-not-an-existing-route', '/lending/not-real', '/assets/missing.js', '/assets/private.js.map', '/random-missing.yml',
    '/%2e%2e/package.json', '/%2eenv', '/%252e%252e%252f.env', '/%25252e%25252e%25252f.env',
    '/assets/../../.env', '/assets/%2e%2e/%2eenv', '/assets/%252e%252e%252f.env', '/assets/..%5c.env', '/assets/%00.js', '/%bad-encoding'];
  for (const prefix of ['', '/avalanche/ecosystem']) {
    for (const pathname of denied) {
      const response = await requestRaw(`${prefix}${pathname}`);
      assert.equal(response.status, 404, `${prefix}${pathname}`);
      assert.match(response.headers['content-type'], /application\/json/);
      assert.deepEqual(JSON.parse(response.body), { error: 'not_found' });
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
    }
  }
});

test('live endpoint exposes an explicit disabled state in isolated tests', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/live`);
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.schema, 'couchdicks.avalanche.live-pulse.v2');
  assert.equal(payload.status, 'disabled');
});

test('Radar endpoint exposes an explicit disabled state in isolated tests', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/avalanche/ecosystem/api/radar`);
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.schema, 'couchdicks.avalanche.radar.v1');
  assert.equal(payload.provider, 'avax-radar');
  assert.equal(payload.failureMode, 'disabled');
});

test('published dashboard and API resolve the same accepted snapshot, not stale build data', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/avalanche/ecosystem/data/dashboard.json`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  const published = await response.json();
  const api = await (await fetch(`http://127.0.0.1:${port}/api/dashboard`)).json();
  assert.equal(published.lending.observedAt, api.lending.observedAt);
  assert.deepEqual(published.lending.protocols, api.lending.protocols);
  assert.deepEqual(published.tokenizedAssets, api.tokenizedAssets);
  assert.equal(published.generatedAt, api.generatedAt);
});

test('HTTP snapshot routes ignore mutable state after commit and fail closed on broken commitments', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ecosystem-http-bundle-'));
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
  const testPort = port + 1;
  const names = ['dashboard.json', 'blockspace.json', 'tokenized-activity.json'];
  const bundle = (marker) => Object.fromEntries(names.map((name) => [name, {
    schema: name, generatedAt: marker, tokenizedAssets: { activityStatus: { generatedAt: marker } },
  }]));
  let isolated;
  try {
    await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(root, 'state'), { recursive: true });
    for (const name of serverFixtureFiles) {
      await fs.copyFile(path.join(sourceRoot, name), path.join(root, name));
    }
    for (const [name, payload] of Object.entries(bundle('legacy'))) await fs.writeFile(path.join(root, 'state', name), JSON.stringify(payload));
    isolated = spawn(process.execPath, ['server.mjs'], {
      cwd: root,
      env: { ...process.env, PORT: String(testPort), HOST: '127.0.0.1', LIVE_PULSE_DISABLED: '1', AVAX_RADAR_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    isolated.stdout.on('data', (chunk) => { output += chunk; });
    isolated.stderr.on('data', (chunk) => { output += chunk; });
    const get = (route) => fetch(`http://127.0.0.1:${testPort}/avalanche/ecosystem${route}`);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { if ((await get('/api/dashboard')).status === 200) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, output);
    const routes = ['/api/dashboard', ...names.map((name) => `/data/${name}`)];
    for (const route of routes) assert.equal((await (await get(route)).json()).generatedAt, 'legacy', 'legacy state fallback works before first pointer');
    const committed = await publishSnapshotBundle(root, bundle('committed'));
    for (const [name, payload] of Object.entries(bundle('unpublished'))) {
      await fs.writeFile(path.join(root, 'state', name), JSON.stringify(payload));
      await fs.writeFile(path.join(root, 'public/data', name), JSON.stringify(payload));
    }
    for (const route of routes) {
      const response = await get(route);
      assert.equal(response.status, 200, route);
      assert.equal((await response.json()).generatedAt, 'committed', route);
    }
    await fs.writeFile(path.join(root, 'state/published/releases', committed.id, 'dashboard.json'), JSON.stringify(bundle('tampered')['dashboard.json']));
    for (const route of ['/api/dashboard', '/data/dashboard.json']) assert.equal((await get(route)).status, 503, 'digest mismatch must not use mutable fallback');
    await publishSnapshotBundle(root, bundle('next'));
    for (const route of routes) assert.equal((await (await get(route)).json()).generatedAt, 'next', 'pointer is resolved anew after publication');
    await fs.writeFile(path.join(root, 'state/published/current.json'), '{invalid');
    for (const route of routes) assert.equal((await get(route)).status, 503, 'invalid pointer must not use mutable fallback');
  } finally {
    if (isolated && isolated.exitCode == null) {
      const exited = new Promise((resolve) => isolated.once('exit', resolve));
      isolated.kill('SIGTERM');
      await exited;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('API and static dashboard age frozen tokenized data without advancing source or publication clocks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ecosystem-http-freshness-'));
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
  const testPort = port + 2;
  const now = Date.parse('2026-09-18T12:00:00Z');
  const observedAt = '2026-09-18T11:55:00Z';
  const canonicalTime = '2026-09-18T11:59:00Z';
  const publishedAt = '2026-09-18T11:59:10Z';
  const sourceId = 'avalanche-gateway-tokenized-assets';
  const fieldStatus = Object.fromEntries(['totalSupply', 'valuationUsd', 'valueUsd', 'symbol', 'tokenName', 'holders'].map((name) => [name, { availability: 'available', retainedLastGood: false, observedAt }]));
  const dashboard = {
    schema: 'dashboard-test', generatedAt: publishedAt, metadata: { freshness: 'healthy' },
    overview: { kpis: { tokenizedAssetValueUsd: 40, unrelated: 123 } }, lending: { unchanged: true },
    quality: { sourceHealth: [{ id: 'unrelated', ok: true, fetchedAt: observedAt }, { id: sourceId, ok: true, fetchedAt: canonicalTime }] },
    tokenizedAssets: {
      updatedAt: publishedAt, canonicalSnapshot: { generatedAt: canonicalTime, availability: 'available' },
      activityStatus: { generatedAt: observedAt },
      kpis: { verifiedContractValueUsd: 40, valueAvailability: 'available', rwaAdapterTvlUsd: 15 },
      assets: ['buidl', 'vbill', 'acred', 'secz'].map((id) => ({ id, totalSupply: 10, valuationUsd: 1, valueUsd: 10, holders: 2, symbol: id.toUpperCase(), tokenName: id, fieldStatus: structuredClone(fieldStatus) })),
    },
  };
  const clockFile = path.join(root, 'clock.json');
  let isolated;
  try {
    await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
    for (const name of serverFixtureFiles) await fs.copyFile(path.join(sourceRoot, name), path.join(root, name));
    await fs.writeFile(clockFile, String(now));
    // Test-process-only clock injection; the production server has no test clock setting.
    await fs.writeFile(path.join(root, 'frozen-clock.mjs'), "import { readFileSync } from 'node:fs'; const clock = new URL('./clock.json', import.meta.url); Date.now = () => Number(readFileSync(clock, 'utf8'));\n");
    const manifest = await publishSnapshotBundle(root, {
      'dashboard.json': dashboard,
      'blockspace.json': { schema: 'blockspace-test', generatedAt: observedAt },
      'tokenized-activity.json': { schema: 'activity-test', generatedAt: observedAt },
    });
    const committedPath = path.join(root, 'state/published/releases', manifest.id, 'dashboard.json');
    const committedBefore = await fs.readFile(committedPath, 'utf8');
    isolated = spawn(process.execPath, ['--import', './frozen-clock.mjs', 'server.mjs'], {
      cwd: root,
      env: { ...process.env, PORT: String(testPort), HOST: '127.0.0.1', LIVE_PULSE_DISABLED: '1', AVAX_RADAR_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    isolated.stdout.on('data', (chunk) => { output += chunk; });
    isolated.stderr.on('data', (chunk) => { output += chunk; });
    const read = async (route) => {
      const response = await fetch(`http://127.0.0.1:${testPort}/avalanche/ecosystem${route}`);
      assert.equal(response.status, 200, route);
      return response.json();
    };
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { await read('/api/dashboard'); ready = true; break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, output);
    const readBoth = async () => {
      const api = await read('/api/dashboard');
      const published = await read('/data/dashboard.json');
      assert.deepEqual(published, api, 'API and static route apply identical time rules');
      assert.equal(api.generatedAt, publishedAt);
      assert.equal(api.tokenizedAssets.updatedAt, publishedAt);
      assert.equal(api.tokenizedAssets.canonicalSnapshot.generatedAt, canonicalTime);
      assert.equal(api.quality.sourceHealth.find((row) => row.id === sourceId).fetchedAt, canonicalTime);
      assert.deepEqual(api.lending, dashboard.lending);
      assert.equal(api.overview.kpis.unrelated, 123);
      for (const asset of api.tokenizedAssets.assets) {
        for (const field of ['totalSupply', 'valuationUsd', 'valueUsd']) assert.equal(asset.fieldStatus[field].observedAt, observedAt);
      }
      return api;
    };
    assert.deepEqual(await readBoth(), dashboard, 'fresh snapshots remain semantically untouched');
    await fs.writeFile(clockFile, String(Date.parse(canonicalTime) + 900_000));
    assert.deepEqual(await readBoth(), dashboard, 'exactly 900 seconds remains within freshness window');
    await fs.writeFile(clockFile, String(Date.parse(canonicalTime) + 900_001));
    const stale = await readBoth();
    assert.equal(stale.tokenizedAssets.kpis.valueAvailability, 'stale');
    assert.equal(stale.tokenizedAssets.assets[0].valueUsd, 10);
    assert.equal(stale.tokenizedAssets.assets[0].fieldStatus.totalSupply.retainedLastGood, true);
    assert.equal(stale.metadata.freshness, 'degraded');
    assert.equal(stale.quality.sourceHealth.find((row) => row.id === sourceId).ok, false);
    await fs.writeFile(clockFile, String(Date.parse(observedAt) + 86_400_001));
    const expiredSupply = await readBoth();
    assert.equal(expiredSupply.tokenizedAssets.kpis.verifiedContractValueUsd, null);
    assert.ok(expiredSupply.tokenizedAssets.assets.every((row) => row.totalSupply === null && row.valueUsd === null && row.valuationUsd === 1));
    await fs.writeFile(clockFile, String(Date.parse(observedAt) + 172_800_001));
    const expiredNav = await readBoth();
    assert.ok(expiredNav.tokenizedAssets.assets.filter((row) => row.id !== 'secz').every((row) => row.valuationUsd === null));
    assert.equal(expiredNav.tokenizedAssets.assets.find((row) => row.id === 'secz').valuationUsd, 1, 'SECZ EOD uses the 72-hour boundary');
    await fs.writeFile(clockFile, String(Date.parse(observedAt) + 259_200_001));
    assert.ok((await readBoth()).tokenizedAssets.assets.every((row) => row.valuationUsd === null));
    assert.equal(await fs.readFile(committedPath, 'utf8'), committedBefore, 'serving never rewrites the committed bundle');
  } finally {
    if (isolated && isolated.exitCode == null) {
      const exited = new Promise((resolve) => isolated.once('exit', resolve));
      isolated.kill('SIGTERM'); await exited;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

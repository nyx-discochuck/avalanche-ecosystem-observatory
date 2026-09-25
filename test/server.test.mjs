import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const port = 18976;
let child;
let childOutput = '';

// Node 24 honors HTTP(S)_PROXY for fetch; keep the isolated test server on
// loopback instead of sending its requests through an environment proxy.
process.env.NO_PROXY = [...new Set([...(process.env.NO_PROXY || '').split(',').filter(Boolean), '127.0.0.1', 'localhost'])].join(',');

before(async () => {
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: {
      ...process.env,
      NO_PROXY: process.env.NO_PROXY,
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

test('health and snapshot endpoints expose cached data', async () => {
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  const dashboard = await fetch(`http://127.0.0.1:${port}/avalanche/ecosystem/api/dashboard`);
  assert.equal(health.status, 200);
  assert.equal(dashboard.status, 200);
  const healthPayload = await health.json();
  const dashboardPayload = await dashboard.json();
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
  for (const pathname of ['/.env', '/state/dashboard.json', '/package.json', '/%2e%2e/package.json', '/assets/private.js.map', '/random-missing.yml']) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
    assert.equal(response.status, 404, pathname);
    assert.deepEqual(await response.json(), { error: 'not_found' });
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

test('published dashboard fallback serves the refreshed public snapshot, not stale build data', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/avalanche/ecosystem/data/dashboard.json`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  const published = await response.json();
  const api = await (await fetch(`http://127.0.0.1:${port}/api/dashboard`)).json();
  assert.equal(published.lending.observedAt, api.lending.observedAt);
  assert.deepEqual(published.lending.protocols, api.lending.protocols);
});

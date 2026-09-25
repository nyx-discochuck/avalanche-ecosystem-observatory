import assert from 'node:assert/strict';
import test from 'node:test';
import { createRadarService, normalizeRadarPayload } from '../radar-adapter.mjs';

const NOW = Date.parse('2026-08-06T17:45:00.000Z');

function health(overrides = {}) {
  return {
    ok: true,
    collector: {
      posture: 'healthy',
      lastSyncAt: '2026-08-06T17:44:51.000Z',
      lastSyncedBlock: 92182500,
      currentRpcTip: 92182507,
      lag: 7,
      rpcPosture: 'healthy',
      availableRpcCount: 3,
      totalRpcCount: 3,
      recentTransferCount: 3187,
      recentNativeTransferCount: 31,
      ...overrides,
    },
  };
}

test('normalizes Radar health and scored activity into the ecosystem contract', () => {
  const payload = normalizeRadarPayload({
    health: health(),
    alerts: { items: [{ eventId: 'alert-1', title: 'High-value activity' }] },
    heartbeats: { items: [{ eventId: 'heartbeat-1' }] },
  }, { now: NOW, maxAgeSeconds: 120 });
  assert.equal(payload.schema, 'couchdicks.avalanche.radar.v1');
  assert.equal(payload.available, true);
  assert.equal(payload.fresh, true);
  assert.equal(payload.ageSeconds, 9);
  assert.equal(payload.lagBlocks, 7);
  assert.equal(payload.alerts.length, 1);
  assert.equal(payload.heartbeats.length, 1);
});

test('marks stale Radar data without invalidating the dashboard contract', () => {
  const payload = normalizeRadarPayload({ health: health({ posture: 'degraded', lastSyncAt: '2026-08-06T17:30:00.000Z' }) }, { now: NOW });
  assert.equal(payload.available, true);
  assert.equal(payload.fresh, false);
  assert.equal(payload.failureMode, 'stale-or-degraded');
});

test('Radar transport failure returns a bounded fail-open unavailable shape', async () => {
  const service = createRadarService({
    now: () => NOW,
    timeoutMs: 100,
    fetchImpl: async () => { throw new Error('Radar database offline'); },
  });
  const payload = await service.get();
  assert.equal(payload.available, false);
  assert.equal(payload.fresh, false);
  assert.equal(payload.failureMode, 'unavailable');
  assert.deepEqual(payload.alerts, []);
  assert.match(payload.error, /database offline/);
});

test('Radar requests health, alerts, and heartbeats with a bounded activity limit', async () => {
  const paths = [];
  const service = createRadarService({
    now: () => NOW,
    activityLimit: 4,
    fetchImpl: async (url) => {
      paths.push(new URL(url).pathname + new URL(url).search);
      const pathname = new URL(url).pathname;
      const body = pathname.endsWith('/health') ? health() : { ok: true, items: [] };
      return { ok: true, status: 200, json: async () => body };
    },
  });
  const payload = await service.get();
  assert.equal(payload.fresh, true);
  assert.deepEqual(paths.sort(), [
    '/api/health',
    '/api/recent-alerts?limit=4',
    '/api/recent-heartbeats?limit=4',
  ]);
});

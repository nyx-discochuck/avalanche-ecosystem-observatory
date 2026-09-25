const DEFAULT_BASE_URL = 'http://127.0.0.1:43140';
const DEFAULT_TIMEOUT_MS = 1_500;
const DEFAULT_MAX_AGE_SECONDS = 120;
const DEFAULT_ACTIVITY_LIMIT = 8;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, Math.floor(number)))
    : fallback;
}

function unavailable({ now, maxAgeSeconds, error, failureMode = 'unavailable' }) {
  return {
    schema: 'couchdicks.avalanche.radar.v1',
    provider: 'avax-radar',
    available: false,
    fresh: false,
    posture: 'unavailable',
    checkedAt: new Date(now).toISOString(),
    lastSyncAt: null,
    ageSeconds: null,
    maxAgeSeconds,
    lastSyncedBlock: null,
    currentRpcTip: null,
    lagBlocks: null,
    rpcPosture: 'unavailable',
    rpcFailoverActive: false,
    availableRpcCount: null,
    totalRpcCount: null,
    recentTransferCount: null,
    recentNativeTransferCount: null,
    alerts: [],
    heartbeats: [],
    failureMode,
    error,
  };
}

export function normalizeRadarPayload({ health, alerts, heartbeats }, {
  now = Date.now(),
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
} = {}) {
  const collector = health?.collector;
  if (!health?.ok || !collector || typeof collector !== 'object') {
    throw new Error('invalid AVAX Radar health contract');
  }

  const lastSyncAt = typeof collector.lastSyncAt === 'string' ? collector.lastSyncAt : null;
  const parsedSyncAt = lastSyncAt ? Date.parse(lastSyncAt) : NaN;
  const ageSeconds = Number.isFinite(parsedSyncAt)
    ? Math.max(0, Math.round((now - parsedSyncAt) / 1000))
    : finiteNumber(collector.syncAgeSeconds);
  const posture = String(collector.posture || 'unknown');
  const fresh = ageSeconds !== null && ageSeconds <= maxAgeSeconds && posture === 'healthy';

  return {
    schema: 'couchdicks.avalanche.radar.v1',
    provider: 'avax-radar',
    available: true,
    fresh,
    posture,
    checkedAt: new Date(now).toISOString(),
    lastSyncAt,
    ageSeconds,
    maxAgeSeconds,
    lastSyncedBlock: finiteNumber(collector.lastSyncedBlock),
    currentRpcTip: finiteNumber(collector.currentRpcTip),
    lagBlocks: finiteNumber(collector.lag),
    rpcPosture: String(collector.rpcPosture || 'unknown'),
    rpcFailoverActive: Boolean(collector.rpcFailoverActive),
    availableRpcCount: finiteNumber(collector.availableRpcCount),
    totalRpcCount: finiteNumber(collector.totalRpcCount),
    recentTransferCount: finiteNumber(collector.recentTransferCount),
    recentNativeTransferCount: finiteNumber(collector.recentNativeTransferCount),
    alerts: Array.isArray(alerts?.items) ? alerts.items : [],
    heartbeats: Array.isArray(heartbeats?.items) ? heartbeats.items : [],
    failureMode: fresh ? null : 'stale-or-degraded',
    error: null,
  };
}

export function createRadarService(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 50, 10_000);
  const maxAgeSeconds = boundedInteger(options.maxAgeSeconds, DEFAULT_MAX_AGE_SECONDS, 15, 3_600);
  const activityLimit = boundedInteger(options.activityLimit, DEFAULT_ACTIVITY_LIMIT, 1, 20);
  const now = options.now || Date.now;
  let latest = null;

  async function request(pathname, signal) {
    const response = await fetchImpl(`${baseUrl}${pathname}`, {
      headers: { accept: 'application/json' },
      signal,
    });
    if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
    return response.json();
  }

  async function get() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const [health, alerts, heartbeats] = await Promise.all([
        request('/api/health', controller.signal),
        request(`/api/recent-alerts?limit=${activityLimit}`, controller.signal),
        request(`/api/recent-heartbeats?limit=${activityLimit}`, controller.signal),
      ]);
      latest = normalizeRadarPayload({ health, alerts, heartbeats }, { now: now(), maxAgeSeconds });
    } catch (error) {
      latest = unavailable({
        now: now(),
        maxAgeSeconds,
        failureMode: error?.name === 'AbortError' ? 'timeout' : 'unavailable',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
    }
    return latest;
  }

  return {
    get,
    peek: () => latest,
  };
}

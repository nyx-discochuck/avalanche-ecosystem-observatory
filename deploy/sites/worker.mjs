const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://icons.llamao.fi https://coin-images.coingecko.com; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};
const LIVE_RPC_URL = 'https://api.avax.network/ext/bc/C/rpc';
const SUPPLY_URL = 'https://data-api.avax.network/v1/avax/supply';
let networkCache = { value: null, expiresAt: 0, promise: null };
let marketCache = { value: null, expiresAt: 0, promise: null };
let supplyCache = { value: null, expiresAt: 0, promise: null };

function numberFromHex(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) return null;
  return Number(BigInt(value));
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function isoDate(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function supplySummary(payload = {}) {
  const totalSupplyAvax = numeric(payload.totalSupply);
  const circulatingSupplyAvax = numeric(payload.circulatingSupply);
  const genesisUnlockAvax = numeric(payload.genesisUnlock);
  const stakingRewardsMintedAvax = numeric(payload.totalRewards);
  const pChainBurnedAvax = numeric(payload.totalPBurned);
  const cChainBurnedAvax = numeric(payload.totalCBurned);
  const xChainBurnedAvax = numeric(payload.totalXBurned);
  const totalStakedAvax = numeric(payload.totalStaked);
  const totalLockedAvax = numeric(payload.totalLocked);
  const l1ValidatorFeesAvax = numeric(payload.l1ValidatorFees);
  const burnParts = [pChainBurnedAvax, cChainBurnedAvax, xChainBurnedAvax];
  const networkBurnedAvax = burnParts.every((value) => value != null)
    ? burnParts.reduce((total, value) => total + value, 0)
    : null;
  return {
    totalSupplyAvax,
    circulatingSupplyAvax,
    genesisUnlockAvax,
    stakingRewardsMintedAvax,
    pChainBurnedAvax,
    cChainBurnedAvax,
    xChainBurnedAvax,
    networkBurnedAvax,
    netSupplySinceGenesisAvax: totalSupplyAvax != null && genesisUnlockAvax != null
      ? totalSupplyAvax - genesisUnlockAvax
      : null,
    totalStakedAvax,
    stakedSharePct: totalSupplyAvax && totalStakedAvax != null
      ? (totalStakedAvax / totalSupplyAvax) * 100
      : null,
    totalLockedAvax,
    l1ValidatorFeesAvax,
    updatedAt: isoDate(payload.lastUpdated),
  };
}

async function remoteJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  const started = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { ok: true, data: await response.json(), fetchedAt: new Date().toISOString(), latencyMs: Date.now() - started, error: null };
  } catch (error) {
    return { ok: false, data: null, fetchedAt: new Date().toISOString(), latencyMs: Date.now() - started, error: error?.name === 'AbortError' ? 'request timed out' : String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function rpc(method, params, id) {
  const response = await remoteJson(LIVE_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  if (response.data?.error) return { ...response, ok: false, error: response.data.error.message || 'RPC error' };
  return response;
}

async function cached(cache, ttlMs, loader) {
  if (cache.value && Date.now() < cache.expiresAt) return cache.value;
  if (cache.promise) return cache.promise;
  cache.promise = loader()
    .then((value) => {
      cache.value = value;
      cache.expiresAt = Date.now() + ttlMs;
      return value;
    })
    .finally(() => {
      cache.promise = null;
    });
  return cache.promise;
}

async function networkPulse() {
  const latest = await rpc('eth_getBlockByNumber', ['latest', false], 1);
  const latestNumber = numberFromHex(latest.data?.result?.number);
  if (!latest.ok || latestNumber == null) throw new Error(latest.error || 'latest block unavailable');
  const results = await Promise.all(Array.from({ length: 11 }, (_, index) => {
    const number = latestNumber - index - 1;
    return rpc('eth_getBlockByNumber', [`0x${number.toString(16)}`, false], index + 2);
  }));
  if (results.some((result) => !result.ok)) throw new Error('recent block sample incomplete');
  const blocks = [latest.data.result, ...results.map((result) => result.data.result)]
    .map((block) => {
      const gasUsed = numberFromHex(block.gasUsed);
      const gasLimit = numberFromHex(block.gasLimit);
      const timestamp = numberFromHex(block.timestamp);
      return {
        number: numberFromHex(block.number),
        timestamp: new Date(timestamp * 1000).toISOString(),
        timestampUnix: timestamp,
        txCount: block.transactions?.length || 0,
        gasUsed,
        gasLimit,
        gasUtilizationPct: gasLimit ? rounded(gasUsed / gasLimit * 100) : null,
        baseFeeGwei: numberFromHex(block.baseFeePerGas) == null ? null : rounded(numberFromHex(block.baseFeePerGas) / 1e9, 6),
      };
    })
    .sort((left, right) => left.number - right.number);
  const first = blocks[0];
  const head = blocks.at(-1);
  const measured = blocks.slice(1);
  const sampleSeconds = Math.max(0, head.timestampUnix - first.timestampUnix);
  const transactions = measured.reduce((total, block) => total + block.txCount, 0);
  const gasUsed = measured.reduce((total, block) => total + (block.gasUsed || 0), 0);
  const gasLimit = measured.reduce((total, block) => total + (block.gasLimit || 0), 0);
  return {
    value: {
      blockNumber: head.number,
      blockTimestamp: head.timestamp,
      blockAgeSeconds: Math.max(0, rounded((Date.now() - head.timestampUnix * 1000) / 1000, 1)),
      sampleBlocks: measured.length,
      sampleSeconds,
      transactions,
      tps: sampleSeconds ? rounded(transactions / sampleSeconds) : null,
      blockTimeSeconds: measured.length ? rounded(sampleSeconds / measured.length) : null,
      gasUtilizationPct: gasLimit ? rounded(gasUsed / gasLimit * 100) : null,
      baseFeeGwei: head.baseFeeGwei,
      blocks: [...blocks].reverse().slice(0, 10).map(({ timestampUnix, gasUsed: _used, gasLimit: _limit, ...block }) => block),
    },
    source: { id: 'avalanche-public-rpc', ok: true, required: true, fetchedAt: latest.fetchedAt, latencyMs: latest.latencyMs, error: null },
  };
}

async function marketPulse() {
  const [avax, chains, dex] = await Promise.all([
    remoteJson('https://api.coinpaprika.com/v1/tickers/avax-avalanche'),
    remoteJson('https://api.llama.fi/v2/chains'),
    remoteJson('https://api.llama.fi/overview/dexs/Avalanche?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true&dataType=dailyVolume'),
  ]);
  const quote = avax.data?.quotes?.USD || {};
  const chain = Array.isArray(chains.data) ? chains.data.find((row) => row.name === 'Avalanche') : null;
  const dexPoint = Array.isArray(dex.data?.totalDataChart) ? dex.data.totalDataChart.at(-1) : null;
  return {
    value: {
      avaxPriceUsd: numeric(quote.price),
      avaxChange24hPct: numeric(quote.percent_change_24h),
      avaxMarketCapUsd: numeric(quote.market_cap),
      chainTvlUsd: numeric(chain?.tvl),
      currentDexDayVolumeUsd: numeric(dexPoint?.[1]),
      currentDexDayDate: dexPoint?.[0] == null ? null : new Date(Number(dexPoint[0]) * 1000).toISOString().slice(0, 10),
      dexWindow: 'current-utc-day-partial',
    },
    sources: [
      { id: 'coinpaprika', ok: avax.ok, required: false, fetchedAt: avax.fetchedAt, latencyMs: avax.latencyMs, error: avax.error },
      { id: 'defillama-tvl', ok: chains.ok, required: false, fetchedAt: chains.fetchedAt, latencyMs: chains.latencyMs, error: chains.error },
      { id: 'defillama-dimensions', ok: dex.ok, required: false, fetchedAt: dex.fetchedAt, latencyMs: dex.latencyMs, error: dex.error },
    ],
  };
}

async function supplyPulse() {
  const result = await remoteJson(SUPPLY_URL, {
    headers: { accept: 'application/json' },
  });
  return {
    value: supplySummary(result.data || {}),
    source: {
      id: 'avalanche-data-api',
      ok: result.ok,
      required: false,
      fetchedAt: result.fetchedAt,
      latencyMs: result.latencyMs,
      error: result.error,
    },
  };
}

async function livePulse() {
  const [network, market, supply] = await Promise.all([
    cached(networkCache, 10_000, networkPulse),
    cached(marketCache, 60_000, marketPulse),
    cached(supplyCache, 60_000, supplyPulse),
  ]);
  const sources = [network.source, ...market.sources, supply.source];
  return {
    schema: 'couchdicks.avalanche.live-pulse.v2',
    generatedAt: new Date().toISOString(),
    status: sources.every((source) => source.ok) ? 'live' : 'degraded',
    cadenceSeconds: 10,
    network: network.value,
    market: market.value,
    economics: supply.value,
    sources,
  };
}

function withSecurity(response, cacheControl) {
  const next = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) next.headers.set(name, value);
  if (cacheControl) next.headers.set('Cache-Control', cacheControl);
  return next;
}

function json(payload, status = 200) {
  return withSecurity(new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  }), 'no-store');
}

async function asset(env, request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return env.ASSETS.fetch(new Request(url, request));
}

async function dashboard(env, request) {
  const response = await asset(env, request, '/data/dashboard.json');
  if (!response.ok) throw new Error('release snapshot unavailable');
  return response;
}

export default {
  async fetch(request, env) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return withSecurity(new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } }));
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/dashboard') {
        return withSecurity(await dashboard(env, request), 'public, max-age=60, must-revalidate');
      }
      if (url.pathname === '/api/live') {
        try {
          const payload = await livePulse();
          return json(payload, payload.status === 'live' ? 200 : 207);
        } catch (error) {
          return json({
            schema: 'couchdicks.avalanche.live-pulse.v2',
            status: 'unavailable',
            error: 'live_pulse_unavailable',
            detail: String(error?.message || error),
          }, 503);
        }
      }
      if (url.pathname === '/api/health' || url.pathname === '/healthz') {
        const payload = await (await dashboard(env, request)).json();
        return json({
          status: payload.metadata?.freshness === 'healthy' ? 'ok' : 'degraded',
          generatedAt: payload.generatedAt,
          ageSeconds: Math.max(0, Math.round((Date.now() - Date.parse(payload.generatedAt)) / 1000)),
          completeThrough: payload.metadata?.latestCompleteDate,
          blockNumber: payload.status?.blockNumber,
          sourceHealth: payload.quality?.sourceHealth,
          verificationSummary: payload.quality?.verification?.summary,
          verificationSourceHealth: payload.quality?.verificationSourceHealth,
          mode: 'release-snapshot',
        });
      }
      if (url.pathname === '/api/catalog') {
        const [metrics, protocols, sources] = await Promise.all([
          asset(env, request, '/data/metric-catalog.json').then((response) => response.json()),
          asset(env, request, '/data/protocol-registry.json').then((response) => response.json()),
          asset(env, request, '/data/sources.json').then((response) => response.json()),
        ]);
        return json({ metrics, protocols, sources });
      }
      if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);

      const response = await env.ASSETS.fetch(request);
      if (response.status !== 404 || /\.[a-z0-9]+$/i.test(url.pathname)) return withSecurity(response);
      return withSecurity(await asset(env, request, '/index.html'), 'public, max-age=0, must-revalidate');
    } catch {
      return json({ error: 'release_snapshot_unavailable' }, 503);
    }
  },
};

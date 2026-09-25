const DEFAULT_RPC_URL = 'https://api.avax.network/ext/bc/C/rpc';
const DEFAULT_SAMPLE_SIZE = 12;
const NETWORK_TTL_MS = 10_000;
const MARKET_TTL_MS = 60_000;
const SUPPLY_TTL_MS = 60_000;

const MARKET_URLS = {
  avax: 'https://api.coinpaprika.com/v1/tickers/avax-avalanche',
  chains: 'https://api.llama.fi/v2/chains',
  dex: 'https://api.llama.fi/overview/dexs/Avalanche?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true&dataType=dailyVolume',
};
const SUPPLY_URL = 'https://data-api.avax.network/v1/avax/supply';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hexNumber(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) return null;
  const number = Number(BigInt(value));
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function unixDate(value) {
  const timestamp = finite(value);
  if (timestamp == null) return null;
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function validIso(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export function summarizeSupply(payload = {}) {
  const totalSupplyAvax = finite(payload.totalSupply);
  const circulatingSupplyAvax = finite(payload.circulatingSupply);
  const genesisUnlockAvax = finite(payload.genesisUnlock);
  const stakingRewardsMintedAvax = finite(payload.totalRewards);
  const pChainBurnedAvax = finite(payload.totalPBurned);
  const cChainBurnedAvax = finite(payload.totalCBurned);
  const xChainBurnedAvax = finite(payload.totalXBurned);
  const totalStakedAvax = finite(payload.totalStaked);
  const totalLockedAvax = finite(payload.totalLocked);
  const l1ValidatorFeesAvax = finite(payload.l1ValidatorFees);
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
    updatedAt: validIso(payload.lastUpdated),
  };
}

export function summarizeBlocks(rawBlocks, nowMs = Date.now()) {
  const blocks = rawBlocks
    .map((block) => {
      const number = hexNumber(block?.number);
      const timestamp = hexNumber(block?.timestamp);
      const gasUsed = hexNumber(block?.gasUsed);
      const gasLimit = hexNumber(block?.gasLimit);
      const baseFeeWei = hexNumber(block?.baseFeePerGas);
      if (number == null || timestamp == null) return null;
      return {
        number,
        timestamp: new Date(timestamp * 1000).toISOString(),
        timestampUnix: timestamp,
        txCount: Array.isArray(block.transactions) ? block.transactions.length : 0,
        gasUsed,
        gasLimit,
        gasUtilizationPct: gasUsed != null && gasLimit ? round((gasUsed / gasLimit) * 100, 2) : null,
        baseFeeGwei: baseFeeWei == null ? null : round(baseFeeWei / 1e9, 6),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.number - right.number);

  if (!blocks.length) throw new Error('Avalanche RPC returned no usable blocks');
  const first = blocks[0];
  const latest = blocks.at(-1);
  const sampleSeconds = Math.max(0, latest.timestampUnix - first.timestampUnix);
  const measuredBlocks = blocks.slice(1);
  const transactions = measuredBlocks.reduce((total, block) => total + block.txCount, 0);
  const gasUsed = measuredBlocks.reduce((total, block) => total + (block.gasUsed || 0), 0);
  const gasLimit = measuredBlocks.reduce((total, block) => total + (block.gasLimit || 0), 0);

  return {
    blockNumber: latest.number,
    blockTimestamp: latest.timestamp,
    blockAgeSeconds: Math.max(0, round((nowMs - latest.timestampUnix * 1000) / 1000, 1)),
    sampleBlocks: measuredBlocks.length,
    sampleSeconds,
    transactions,
    tps: sampleSeconds ? round(transactions / sampleSeconds, 2) : null,
    blockTimeSeconds: measuredBlocks.length ? round(sampleSeconds / measuredBlocks.length, 2) : null,
    gasUtilizationPct: gasLimit ? round((gasUsed / gasLimit) * 100, 2) : null,
    baseFeeGwei: latest.baseFeeGwei,
    blocks: [...blocks].reverse().slice(0, 10).map(({ timestampUnix, gasUsed: _gasUsed, gasLimit: _gasLimit, ...block }) => block),
  };
}

async function requestJson(fetchImpl, url, options = {}) {
  const { timeoutMs = 8_000, ...requestOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(url, {
      ...requestOptions,
      headers: {
        accept: 'application/json',
        'user-agent': 'avalanche-ecosystem-dashboard-live/1.0',
        ...requestOptions.headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return {
      ok: true,
      data: await response.json(),
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      error: error?.name === 'AbortError' ? 'request timed out' : String(error?.message || error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sourceState(id, result, required = false) {
  return {
    id,
    ok: Boolean(result?.ok),
    required,
    fetchedAt: result?.fetchedAt || new Date().toISOString(),
    latencyMs: result?.latencyMs ?? null,
    error: result?.error || null,
  };
}

function createCache(ttlMs) {
  return {
    ttlMs,
    expiresAt: 0,
    value: null,
    promise: null,
  };
}

async function cached(cache, loader, now) {
  if (cache.value && now() < cache.expiresAt) return cache.value;
  if (cache.promise) return cache.promise;
  cache.promise = loader()
    .then((value) => {
      cache.value = value;
      cache.expiresAt = now() + cache.ttlMs;
      return value;
    })
    .catch((error) => {
      if (!cache.value) throw error;
      return {
        ...cache.value,
        stale: true,
        error: String(error?.message || error),
      };
    })
    .finally(() => {
      cache.promise = null;
    });
  return cache.promise;
}

export function createLivePulseService(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const rpcUrl = options.rpcUrl || DEFAULT_RPC_URL;
  const sampleSize = Math.max(4, Math.min(20, Number(options.sampleSize || DEFAULT_SAMPLE_SIZE)));
  const networkCache = createCache(Number(options.networkTtlMs || NETWORK_TTL_MS));
  const marketCache = createCache(Number(options.marketTtlMs || MARKET_TTL_MS));
  const supplyCache = createCache(Number(options.supplyTtlMs || SUPPLY_TTL_MS));

  async function rpc(method, params, id) {
    return requestJson(fetchImpl, rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      timeoutMs: Number(options.rpcTimeoutMs || 8_000),
    });
  }

  async function loadNetwork() {
    const latestResult = await rpc('eth_getBlockByNumber', ['latest', false], 1);
    if (!latestResult.ok) throw new Error(`Avalanche RPC unavailable: ${latestResult.error}`);
    if (latestResult.data?.error) throw new Error(latestResult.data.error.message || 'Avalanche RPC error');
    const latestNumber = hexNumber(latestResult.data?.result?.number);
    if (latestNumber == null) throw new Error('Avalanche RPC returned an invalid latest block');

    const olderResults = await Promise.all(
      Array.from({ length: sampleSize - 1 }, (_, index) => latestNumber - index - 1)
        .map((number, index) => rpc('eth_getBlockByNumber', [`0x${number.toString(16)}`, false], index + 2)),
    );
    const failed = olderResults.find((result) => !result.ok || result.data?.error);
    if (failed) throw new Error(`Avalanche block sample incomplete: ${failed.error || failed.data?.error?.message || 'RPC error'}`);
    const blocks = [
      latestResult.data.result,
      ...olderResults.map((result) => result.data.result),
    ];
    return {
      stale: false,
      network: summarizeBlocks(blocks, now()),
      source: sourceState('avalanche-public-rpc', latestResult, true),
    };
  }

  async function loadMarket() {
    const [avaxResult, chainsResult, dexResult] = await Promise.all([
      requestJson(fetchImpl, MARKET_URLS.avax),
      requestJson(fetchImpl, MARKET_URLS.chains),
      requestJson(fetchImpl, MARKET_URLS.dex),
    ]);
    const avax = avaxResult.data?.quotes?.USD || {};
    const avalanche = Array.isArray(chainsResult.data)
      ? chainsResult.data.find((chain) => chain.name === 'Avalanche')
      : null;
    const dexPoint = Array.isArray(dexResult.data?.totalDataChart)
      ? dexResult.data.totalDataChart.at(-1)
      : null;
    return {
      stale: false,
      market: {
        avaxPriceUsd: finite(avax.price),
        avaxChange24hPct: finite(avax.percent_change_24h),
        avaxMarketCapUsd: finite(avax.market_cap),
        chainTvlUsd: finite(avalanche?.tvl),
        currentDexDayVolumeUsd: finite(dexPoint?.[1]),
        currentDexDayDate: unixDate(dexPoint?.[0]),
        dexWindow: 'current-utc-day-partial',
      },
      sources: [
        sourceState('coinpaprika', avaxResult),
        sourceState('defillama-tvl', chainsResult),
        sourceState('defillama-dimensions', dexResult),
      ],
    };
  }

  async function loadSupply() {
    const result = await requestJson(fetchImpl, SUPPLY_URL);
    return {
      stale: false,
      economics: summarizeSupply(result.data || {}),
      source: sourceState('avalanche-data-api', result),
    };
  }

  return {
    async get() {
      const [networkResult, marketResult, supplyResult] = await Promise.allSettled([
        cached(networkCache, loadNetwork, now),
        cached(marketCache, loadMarket, now),
        cached(supplyCache, loadSupply, now),
      ]);
      const network = networkResult.status === 'fulfilled' ? networkResult.value : null;
      const market = marketResult.status === 'fulfilled' ? marketResult.value : null;
      const supply = supplyResult.status === 'fulfilled' ? supplyResult.value : null;
      const sources = [
        network?.source || {
          id: 'avalanche-public-rpc',
          ok: false,
          required: true,
          fetchedAt: new Date(now()).toISOString(),
          latencyMs: null,
          error: String(networkResult.reason?.message || networkResult.reason || 'unavailable'),
        },
        ...(market?.sources || [
          { id: 'coinpaprika', ok: false, required: false, fetchedAt: new Date(now()).toISOString(), latencyMs: null, error: String(marketResult.reason?.message || marketResult.reason || 'unavailable') },
          { id: 'defillama-tvl', ok: false, required: false, fetchedAt: new Date(now()).toISOString(), latencyMs: null, error: String(marketResult.reason?.message || marketResult.reason || 'unavailable') },
          { id: 'defillama-dimensions', ok: false, required: false, fetchedAt: new Date(now()).toISOString(), latencyMs: null, error: String(marketResult.reason?.message || marketResult.reason || 'unavailable') },
        ]),
        supply?.source || {
          id: 'avalanche-data-api',
          ok: false,
          required: false,
          fetchedAt: new Date(now()).toISOString(),
          latencyMs: null,
          error: String(supplyResult.reason?.message || supplyResult.reason || 'unavailable'),
        },
      ];
      const degraded = sources.some((source) => !source.ok) || network?.stale || market?.stale || supply?.stale;
      return {
        schema: 'couchdicks.avalanche.live-pulse.v2',
        generatedAt: new Date(now()).toISOString(),
        status: degraded ? 'degraded' : 'live',
        cadenceSeconds: Math.round(networkCache.ttlMs / 1000),
        network: network?.network || null,
        market: market?.market || null,
        economics: supply?.economics || summarizeSupply(),
        sources,
      };
    },
    peek() {
      return {
        network: networkCache.value,
        market: marketCache.value,
        economics: supplyCache.value,
      };
    },
  };
}

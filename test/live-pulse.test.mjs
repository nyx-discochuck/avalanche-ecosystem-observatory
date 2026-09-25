import assert from 'node:assert/strict';
import test from 'node:test';
import { createLivePulseService, summarizeBlocks, summarizeSupply } from '../live-pulse.mjs';

function block(number, timestamp, transactions, gasUsed = 5_000_000, gasLimit = 10_000_000) {
  return {
    number: `0x${number.toString(16)}`,
    timestamp: `0x${timestamp.toString(16)}`,
    transactions: Array.from({ length: transactions }, (_, index) => `0x${number}-${index}`),
    gasUsed: `0x${gasUsed.toString(16)}`,
    gasLimit: `0x${gasLimit.toString(16)}`,
    baseFeePerGas: '0x5d21dba00',
  };
}

test('recent blocks produce an honest bounded live window', () => {
  const summary = summarizeBlocks([
    block(100, 1_000, 4),
    block(101, 1_002, 6),
    block(102, 1_004, 10),
  ], 1_005_000);
  assert.equal(summary.blockNumber, 102);
  assert.equal(summary.sampleBlocks, 2);
  assert.equal(summary.sampleSeconds, 4);
  assert.equal(summary.transactions, 16);
  assert.equal(summary.tps, 4);
  assert.equal(summary.blockTimeSeconds, 2);
  assert.equal(summary.gasUtilizationPct, 50);
  assert.equal(summary.blockAgeSeconds, 1);
  assert.deepEqual(summary.blocks.map((row) => row.number), [102, 101, 100]);
});

test('official AVAX supply fields reconcile the live network ledger', () => {
  const economics = summarizeSupply({
    totalSupply: '465928340.9090603278545619837',
    circulatingSupply: '465928340.9090603278545619837',
    totalPBurned: '17284.12942334710172056775673',
    totalCBurned: '5036751.287247146642566773159',
    totalXBurned: '45611.05991362119279723697449',
    totalStaked: '212854214.59834',
    totalLocked: '29878709.01515025938735048427',
    totalRewards: '111027987.3856444427916465616',
    genesisUnlock: '360000000',
    lastUpdated: '2026-07-26T09:00:24.399Z',
  });
  assert.ok(Math.abs(economics.networkBurnedAvax - 5_099_646.476584115) < 1e-6);
  assert.ok(Math.abs(
    economics.genesisUnlockAvax + economics.stakingRewardsMintedAvax - economics.networkBurnedAvax
    - economics.totalSupplyAvax
  ) < 1e-6);
  assert.ok(Math.abs(economics.netSupplySinceGenesisAvax - 105_928_340.9090603) < 1e-6);
  assert.ok(Math.abs(economics.stakedSharePct - 45.683895120662946) < 1e-9);
  assert.equal(economics.updatedAt, '2026-07-26T09:00:24.399Z');
});

test('live pulse caches RPC and market requests while preserving source scope', async () => {
  let calls = 0;
  const fakeFetch = async (url, options = {}) => {
    calls += 1;
    let payload;
    if (String(url).includes('/ext/bc/C/rpc')) {
      const body = JSON.parse(options.body);
      const requested = body.params[0] === 'latest' ? 103 : Number(BigInt(body.params[0]));
      payload = { jsonrpc: '2.0', id: body.id, result: block(requested, 2_000 + (requested - 100) * 2, requested - 95) };
    } else if (String(url).includes('coinpaprika')) {
      payload = { quotes: { USD: { price: 24.5, percent_change_24h: 3.25, market_cap: 10_000_000_000 } } };
    } else if (String(url).includes('/v2/chains')) {
      payload = [{ name: 'Avalanche', tvl: 420_000_000 }];
    } else if (String(url).includes('/v1/avax/supply')) {
      payload = {
        totalSupply: '465928340.9090603278545619837',
        circulatingSupply: '465928340.9090603278545619837',
        totalPBurned: '17284.12942334710172056775673',
        totalCBurned: '5036751.287247146642566773159',
        totalXBurned: '45611.05991362119279723697449',
        totalStaked: '212854214.59834',
        totalLocked: '29878709.01515025938735048427',
        totalRewards: '111027987.3856444427916465616',
        genesisUnlock: '360000000',
        lastUpdated: '2026-07-26T09:00:24.399Z',
      };
    } else {
      payload = { totalDataChart: [[2_000, 12_500_000]] };
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      json: async () => payload,
    };
  };
  const service = createLivePulseService({
    fetchImpl: fakeFetch,
    now: () => 2_010_000,
    sampleSize: 4,
    networkTtlMs: 12_000,
    marketTtlMs: 60_000,
  });
  const first = await service.get();
  const afterFirst = calls;
  const second = await service.get();

  assert.equal(first.status, 'live');
  assert.equal(first.network.blockNumber, 103);
  assert.equal(first.network.sampleBlocks, 3);
  assert.equal(first.market.avaxPriceUsd, 24.5);
  assert.equal(first.market.chainTvlUsd, 420_000_000);
  assert.equal(first.market.currentDexDayVolumeUsd, 12_500_000);
  assert.equal(first.economics.totalSupplyAvax, 465_928_340.9090603);
  assert.equal(first.schema, 'couchdicks.avalanche.live-pulse.v2');
  assert.deepEqual(first.sources.map((source) => source.id), [
    'avalanche-public-rpc',
    'coinpaprika',
    'defillama-tvl',
    'defillama-dimensions',
    'avalanche-data-api',
  ]);
  assert.equal(calls, afterFirst);
  assert.deepEqual(second.network, first.network);
});

test('live-source failure degrades explicitly without inventing values', async () => {
  const service = createLivePulseService({
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
      headers: new Headers(),
      json: async () => ({}),
    }),
    now: () => 3_000_000,
    sampleSize: 4,
  });
  const payload = await service.get();
  assert.equal(payload.status, 'degraded');
  assert.equal(payload.network, null);
  assert.deepEqual(payload.market, {
    avaxPriceUsd: null,
    avaxChange24hPct: null,
    avaxMarketCapUsd: null,
    chainTvlUsd: null,
    currentDexDayVolumeUsd: null,
    currentDexDayDate: null,
    dexWindow: 'current-utc-day-partial',
  });
  assert.deepEqual(payload.economics, summarizeSupply());
  assert.ok(payload.sources.every((source) => !source.ok));
});

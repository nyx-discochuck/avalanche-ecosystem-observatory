import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AVALANCHE_LENDING_SCOPE,
  LIQUIDATION_TOPICS,
  buildLiquidationMetric,
  buildAvalancheProtocolLiquidity,
  buildVaultMetric,
  decimalAmount,
  decodeRpcUint,
  decodeLiquidationLog,
  compoundedApyPct,
  nativeMarketState,
  compatibleUtilizationPct,
  partitionLendingMarkets,
  rayRatePct,
  validateLendingMarketRow,
  wadRatePct,
} from '../scripts/lending-metrics.mjs';

test('RPC uint decoding fails closed for missing, reverted, and truncated batch-call results', () => {
  assert.equal(decodeRpcUint(null), null);
  assert.equal(decodeRpcUint('0x'), null);
  assert.equal(decodeRpcUint('0x12'), null);
  assert.equal(decodeRpcUint({ error: { code: -32000 } }), null);
  assert.equal(decodeRpcUint(`0x${word(6)}`), 6n);
  assert.equal(decodeRpcUint(`0x${word(8)}`), 8n);
  assert.equal(decodeRpcUint(`0x${word(18)}`), 18n);
});

test('protocol liquidity accepts only Avalanche chain keys and never global or other-chain fallbacks', () => {
  const scoped = buildAvalancheProtocolLiquidity({
    slug: 'example-lender',
    detail: {
      name: 'Example Lender',
      tvl: 9_999,
      borrowed: 8_888,
      currentChainTvls: {
        Avalanche: 40,
        'Avalanche-borrowed': 10,
        Ethereum: 7_777,
        'Ethereum-borrowed': 6_666,
      },
    },
    protocol: { name: 'Wrong fallback', tvl: 5_555, borrowed: 4_444 },
  });
  assert.deepEqual(
    { chain: scoped.chain, chainId: scoped.chainId, scope: scoped.scope, netTvl: scoped.netTvl, borrowed: scoped.borrowed, supplied: scoped.supplied },
    { chain: 'Avalanche', chainId: 43114, scope: 'Avalanche-only', netTvl: 40, borrowed: 10, supplied: null },
  );
  assert.equal(scoped.fieldProvenance.netTvl.sourceField, 'currentChainTvls.Avalanche');
  assert.equal(scoped.availability, 'available');

  const crossChainOnly = buildAvalancheProtocolLiquidity({
    slug: 'example-lender',
    detail: { tvl: 9_999, borrowed: 8_888, currentChainTvls: { Ethereum: 7_777, 'Ethereum-borrowed': 6_666 } },
    protocol: { tvl: 5_555, borrowed: 4_444 },
  });
  assert.deepEqual(
    { netTvl: crossChainOnly.netTvl, borrowed: crossChainOnly.borrowed, supplied: crossChainOnly.supplied, availability: crossChainOnly.availability, deployed: crossChainOnly.deployed },
    { netTvl: null, borrowed: null, supplied: null, availability: 'unavailable', deployed: false },
  );
  assert.deepEqual(
    { chain: crossChainOnly.chain, network: crossChainOnly.network, chainId: crossChainOnly.chainId, scope: crossChainOnly.scope },
    AVALANCHE_LENDING_SCOPE,
  );
});

test('lending accounting never promotes TVL and computes utilization only for compatible positive supplied values', () => {
  assert.equal(validateLendingMarketRow({ tvlUsd: 10, suppliedUsd: 10, fieldProvenance: { supplied: { sourceField: 'tvlUsd' } } }).valid, false);
  assert.equal(validateLendingMarketRow({ tvlUsd: 10, suppliedUsd: null, fieldProvenance: { supplied: { sourceField: null } } }).valid, true);
  assert.equal(compatibleUtilizationPct({ borrowedUsd: 4, suppliedUsd: 10, borrowedAccounting: 'gross', suppliedAccounting: 'gross' }), 40);
  assert.equal(compatibleUtilizationPct({ borrowedUsd: 4, suppliedUsd: 0 }), null);
  assert.equal(compatibleUtilizationPct({ borrowedUsd: null, suppliedUsd: 10 }), null);
  assert.equal(compatibleUtilizationPct({ borrowedUsd: 4, suppliedUsd: 10, borrowedAccounting: 'gross', suppliedAccounting: 'net' }), null);
});

test('impaired Silo fixtures are isolated ahead of deterministic ordinary-market sorting', () => {
  const names = ['xUSD / USDC', 'xUSD / USDT', 'xUSD / AUSD', 'xBTC / BTC.b', 'yUSD / USDC'];
  const rows = [
    { id: 'aave', protocol: 'aave-v3', marketName: 'USDC', suppliedUsd: null, riskState: 'normal' },
    ...names.map((marketName, index) => ({ id: `silo-${index}`, protocol: 'silo-v2', marketName, suppliedUsd: 1_000_000_000 - index, riskState: 'impaired' })),
  ];
  const partitioned = partitionLendingMarkets(rows);
  assert.deepEqual(partitioned.ordinary.map((row) => row.id), ['aave']);
  assert.deepEqual(new Set(partitioned.impaired.map((row) => row.marketName)), new Set(names));
  assert.ok(partitioned.impaired.every((row) => row.status === 'impaired' && row.explorerUrl == null));
});

test('native market state preserves missing-call and stale observation semantics', () => {
  const now = Date.parse('2026-08-16T12:00:00Z');
  const healthy = nativeMarketState({ required: { asset: '0x1', supplyApy: 4, borrowedUsd: 0 }, observedAt: '2026-08-16T11:59:00Z', now });
  assert.deepEqual({ state: healthy.state, freshness: healthy.freshness, missing: healthy.missing }, { state: 'available', freshness: 'fresh', missing: [] });
  const revertedCall = nativeMarketState({ required: { asset: '0x1', supplyApy: null, borrowedUsd: 0 }, observedAt: '2026-08-16T11:59:00Z', now });
  assert.deepEqual({ state: revertedCall.state, missing: revertedCall.missing }, { state: 'partial', missing: ['supplyApy'] });
  const unsupported = nativeMarketState({ required: { supplyApy: null, borrowApy: null }, observedAt: '2026-08-16T11:59:00Z', now });
  assert.equal(unsupported.state, 'unavailable');
  const stale = nativeMarketState({ required: { supplyApy: 1, borrowApy: 2 }, observedAt: '2026-08-16T08:00:00Z', now });
  assert.deepEqual({ state: stale.state, freshness: stale.freshness }, { state: 'stale', freshness: 'stale' });
  const missingObservation = nativeMarketState({ required: { supplyApy: 1 }, observedAt: null, now });
  assert.deepEqual({ state: missingObservation.state, freshness: missingObservation.freshness }, { state: 'available', freshness: 'unknown' });
});

const address = (byte) => `0x${byte.repeat(40)}`;
const topicAddress = (value) => `0x${value.slice(2).padStart(64, '0')}`;
const word = (value) => BigInt(value).toString(16).padStart(64, '0');
const baseLog = (protocol, data, overrides = {}) => ({
  date: '2026-08-01',
  block_number: 100,
  tx_hash: `0x${'ab'.repeat(32)}`,
  log_index: 2,
  address: address('1'),
  topic0: LIQUIDATION_TOPICS[protocol],
  topic1: topicAddress(address('2')),
  topic2: topicAddress(address('3')),
  topic3: topicAddress(address('4')),
  data: `0x${data}`,
  ...overrides,
});

test('protocol-native liquidation decoders preserve debt units and emitter proof', () => {
  const aave = decodeLiquidationLog(baseLog('aave-v3', `${word(25)}${word(50)}${word(0)}${word(0)}`), { protocol: 'aave-v3', knownEmitters: [address('1')] });
  assert.equal(aave.debtRaw, '25');
  assert.equal(aave.asset, address('3'));

  const benqi = decodeLiquidationLog(baseLog('benqi', `${word(0)}${word(0)}${word(75)}${word(0)}${word(0)}`), { protocol: 'benqi', knownEmitters: [address('1')] });
  assert.equal(benqi.debtRaw, '75');

  const euler = decodeLiquidationLog(baseLog('euler-v2', `${word(0)}${word(125)}${word(0)}`), { protocol: 'euler-v2', knownEmitters: [address('1')] });
  assert.equal(euler.debtRaw, '125');
  assert.equal(decodeLiquidationLog(baseLog('euler-v2', word(1)), { protocol: 'euler-v2', knownEmitters: [address('9')] }), null);
});

test('Silo signature matches require a factory-validated silo topic', () => {
  const log = baseLog('silo-v2', `${word(500)}${word(0)}${word(0)}`);
  assert.equal(decodeLiquidationLog(log, { protocol: 'silo-v2', siloValidator: () => false }), null);
  const event = decodeLiquidationLog(log, { protocol: 'silo-v2', siloValidator: (candidate) => candidate === address('3') });
  assert.equal(event.market, address('3'));
  assert.equal(event.debtRaw, '500');
});

test('raw token amounts normalize without losing the fractional component', () => {
  assert.equal(decimalAmount('1234567', 6), 1.234567);
  assert.equal(decimalAmount(null, 6), null);
});

test('protocol-native rate units preserve Euler APY and Silo APR bases', () => {
  const fivePctSpy = 1e27 * 0.05 / (365.2425 * 86400);
  assert.ok(Math.abs(compoundedApyPct(fivePctSpy) - (Math.exp(0.05) - 1) * 100) < 1e-8);
  assert.equal(rayRatePct(5e25), 5);
  assert.equal(wadRatePct(5e16), 5);
  assert.equal(rayRatePct(0), 0);
  assert.equal(wadRatePct(0), 0);
  assert.equal(compoundedApyPct(1e28), null);
  assert.equal(rayRatePct(-1), null);
  assert.equal(wadRatePct(-1), null);
});

test('factory vault metric sums only active, priced, headline-eligible rows', () => {
  const metric = buildVaultMetric([
    { address: address('1'), asset: address('a'), protocol: 'euler-v2', active: true, grossAssetsUsd: 10, borrowedUsd: 6, includedInHeadline: true },
    { address: address('2'), asset: address('b'), protocol: 'euler-v2', active: true, grossAssetsUsd: null, borrowedUsd: null, includedInHeadline: true },
    { address: address('3'), asset: address('c'), protocol: 'silo-v2', active: true, grossAssetsUsd: 99, includedInHeadline: false },
    { address: address('4'), asset: address('d'), protocol: 'euler-v2', active: false, grossAssetsUsd: 1, includedInHeadline: true },
  ], { protocolCoverage: [{ protocol: 'euler-v2', state: 'available' }, { protocol: 'silo-v2', state: 'available' }] });
  assert.equal(metric.grossAssetsUsd, 10);
  assert.equal(metric.borrowedUsd, 6);
  assert.equal(metric.activeVaults, 2);
  assert.equal(metric.pricedActiveVaults, 1);
  assert.equal(metric.unpricedActiveVaults, 1);
  assert.equal(metric.state, 'partial');
  assert.equal(metric.accounting.additive, false);
});

test('liquidation metric preserves verified zero days and separates event/value coverage', () => {
  const events = [
    { id: 'a:1', date: '2026-08-01', protocol: 'aave-v3', blockNumber: 1, logIndex: 1, debtRepaidUsd: 12 },
    { id: 'a:1', date: '2026-08-01', protocol: 'aave-v3', blockNumber: 1, logIndex: 1, debtRepaidUsd: 12 },
    { id: 'b:1', date: '2026-08-01', protocol: 'benqi', blockNumber: 2, logIndex: 1, debtRepaidUsd: null },
  ];
  const metric = buildLiquidationMetric(events, {
    dates: ['2026-08-01', '2026-08-02'],
    expectedProtocols: ['aave-v3', 'benqi'],
    coveredProtocols: ['aave-v3', 'benqi'],
  });
  assert.equal(metric.state, 'available');
  assert.equal(metric.totalEvents, 2);
  assert.equal(metric.pricedEvents, 1);
  assert.equal(metric.valuationCoveragePct, 50);
  assert.deepEqual(metric.history.map((row) => row.events), [2, 0]);
  assert.deepEqual(metric.history.map((row) => row.debtRepaidUsd), [12, 0]);
});

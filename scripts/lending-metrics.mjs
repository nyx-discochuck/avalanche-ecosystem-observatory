export const LIQUIDATION_TOPICS = Object.freeze({
  'aave-v3': '0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286',
  'aave-v4': '0x4dd4921f7e6e5e3041ddcf4e823437f9755e4bbc6692e3b21b62753416c8c96b',
  benqi: '0x298637f684da70674f26509b10f07ec2fbc77a335ab1e7d6215a4b2484d8bb52',
  'euler-v2': '0x8246cc71ab01533b5bebc672a636df812f10637ad720797319d5741d5ebb3962',
  'silo-v2': '0x3a84f64446e8eada995aa9da2ddbfcd9b5d5d650503b19f024096d04c05ef2a9',
});

export const AVALANCHE_LENDING_SCOPE = Object.freeze({
  chain: 'Avalanche',
  network: 'Avalanche C-Chain',
  chainId: 43114,
  scope: 'Avalanche-only',
});

// eth_call failures and omitted batch rows must remain unavailable. Treating an
// empty response as zero is especially dangerous for ERC-20 decimals because it
// turns raw token units into whole tokens and can inflate USD values by 10^18.
export function decodeRpcUint(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) return null;
  const hex = value.slice(2);
  if (hex.length < 64 || hex.length % 2 !== 0) return null;
  try { return BigInt(`0x${hex.slice(0, 64)}`); }
  catch { return null; }
}

export function validTokenDecimals(value) {
  const decoded = decodeRpcUint(value);
  return decoded != null && decoded <= 255n ? Number(decoded) : null;
}

const finiteMetric = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function buildAvalancheProtocolLiquidity({ slug, detail = null, protocol = null } = {}) {
  const netTvl = finiteMetric(detail?.currentChainTvls?.Avalanche);
  const borrowed = finiteMetric(detail?.currentChainTvls?.['Avalanche-borrowed']);
  const present = [netTvl, borrowed].filter((value) => value != null).length;
  return {
    slug,
    name: detail?.name || protocol?.name || slug,
    ...AVALANCHE_LENDING_SCOPE,
    netTvl,
    borrowed,
    supplied: null,
    availableLiquidity: null,
    utilizationPct: null,
    utilizationDerived: false,
    utilizationFormula: null,
    source: `https://defillama.com/protocol/${slug}`,
    fieldProvenance: {
      netTvl: { sourceField: 'currentChainTvls.Avalanche', accounting: 'source-reported net TVL', derived: false },
      borrowed: { sourceField: 'currentChainTvls.Avalanche-borrowed', accounting: 'source-reported borrowed balance', derived: false },
      supplied: { sourceField: null, accounting: 'gross supplied assets unsupported by this endpoint', derived: false },
      availableLiquidity: { sourceField: null, accounting: 'immediately available underlying liquidity unsupported by this endpoint', derived: false },
    },
    availability: present === 2 ? 'available' : present === 1 ? 'partial' : 'unavailable',
    deployed: present > 0,
  };
}

export function compatibleUtilizationPct({ borrowedUsd, suppliedUsd, borrowedAccounting = null, suppliedAccounting = null } = {}) {
  const borrowed = finiteMetric(borrowedUsd);
  const supplied = finiteMetric(suppliedUsd);
  if (borrowed == null || supplied == null || supplied <= 0) return null;
  if (borrowedAccounting && suppliedAccounting && borrowedAccounting !== suppliedAccounting) return null;
  const value = borrowed / supplied * 100;
  return Number.isFinite(value) ? value : null;
}

export function validateLendingMarketRow(row = {}) {
  const issues = [];
  if (row.suppliedUsd != null && row.fieldProvenance?.supplied?.sourceField === 'tvlUsd') {
    issues.push('suppliedUsd must not be sourced from tvlUsd');
  }
  if (row.suppliedUsd != null && row.suppliedUsd === row.tvlUsd && row.fieldProvenance?.supplied?.sourceField == null) {
    issues.push('suppliedUsd equals tvlUsd without explicit supplied-field provenance');
  }
  return { valid: issues.length === 0, issues };
}

export function partitionLendingMarkets(rows = []) {
  const impaired = [];
  const ordinary = [];
  for (const row of rows) {
    const normalized = {
      ...row,
      status: row.status || (row.riskState === 'impaired' ? 'impaired' : 'ordinary'),
      explorerUrl: row.explorerUrl || (normalizedAddress(row.address) ? `https://snowscan.xyz/address/${row.address}` : null),
    };
    (normalized.status === 'impaired' || normalized.status === 'legacy' ? impaired : ordinary).push(normalized);
  }
  const rank = (a, b) => (finiteMetric(b.suppliedUsd) ?? -1) - (finiteMetric(a.suppliedUsd) ?? -1)
    || String(a.protocol || '').localeCompare(String(b.protocol || ''))
    || String(a.marketName || a.id || '').localeCompare(String(b.marketName || b.id || ''));
  return { ordinary: ordinary.sort(rank), impaired: impaired.sort(rank) };
}

const normalizedAddress = (value) => /^0x[0-9a-f]{40}$/i.test(value || '') ? value.toLowerCase() : null;
const words = (data) => String(data || '').replace(/^0x/, '').match(/.{64}/g) || [];
const addressFromWord = (word) => word?.length === 64 ? normalizedAddress(`0x${word.slice(-40)}`) : null;
const addressFromTopic = (topic) => topic?.length === 66 ? normalizedAddress(`0x${topic.slice(-40)}`) : null;
const rawWord = (word) => {
  try { return BigInt(`0x${word}`).toString(); } catch { return null; }
};

const GREGORIAN_YEAR_SECONDS = 365.2425 * 86400;
export const DEFAULT_NATIVE_MARKET_MAX_AGE_SECONDS = 7_200;

export function nativeMarketState({ required = {}, observedAt = null, now = Date.now(), maxAgeSeconds = DEFAULT_NATIVE_MARKET_MAX_AGE_SECONDS } = {}) {
  const missing = Object.entries(required).filter(([, value]) => value == null || (typeof value === 'number' && !Number.isFinite(value))).map(([key]) => key);
  const observedMs = Date.parse(observedAt || '');
  const ageSeconds = Number.isFinite(observedMs) ? Math.max(0, Math.floor((Number(now) - observedMs) / 1_000)) : null;
  const freshness = ageSeconds == null ? 'unknown' : ageSeconds > maxAgeSeconds ? 'stale' : 'fresh';
  const availability = missing.length === Object.keys(required).length ? 'unavailable' : missing.length ? 'partial' : 'available';
  return {
    state: availability === 'available' && freshness === 'stale' ? 'stale' : availability,
    availability,
    freshness,
    ageSeconds,
    maxAgeSeconds,
    missing,
  };
}

export function compoundedApyPct(ratePerSecondRay) {
  if (ratePerSecondRay == null) return null;
  const rate = Number(ratePerSecondRay) / 1e27;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) return null;
  const apy = Math.expm1(GREGORIAN_YEAR_SECONDS * Math.log1p(rate)) * 100;
  return Number.isFinite(apy) && apy <= 1_000_000 ? apy : null;
}

export function rayRatePct(rateRay) {
  if (rateRay == null) return null;
  const percent = Number(rateRay) / 1e25;
  return Number.isFinite(percent) && percent >= 0 && percent <= 1_000_000 ? percent : null;
}

export function wadRatePct(rateWad) {
  if (rateWad == null) return null;
  const percent = Number(rateWad) / 1e16;
  return Number.isFinite(percent) && percent >= 0 ? percent : null;
}

export function decodeLiquidationLog(log, { protocol, knownEmitters = [], siloValidator = () => true } = {}) {
  const topic0 = String(log?.topic0 || log?.topics?.[0] || '').toLowerCase();
  const emitter = normalizedAddress(log?.address);
  const expectedTopic = LIQUIDATION_TOPICS[protocol];
  if (!expectedTopic || topic0 !== expectedTopic || !emitter) return null;
  const emitters = new Set(knownEmitters.map(normalizedAddress).filter(Boolean));
  if (protocol !== 'silo-v2' && emitters.size && !emitters.has(emitter)) return null;
  const eventWords = words(log.data);
  const topic1 = log.topic1 || log.topics?.[1];
  const topic2 = log.topic2 || log.topics?.[2];
  const topic3 = log.topic3 || log.topics?.[3];
  let asset = null;
  let debtRaw = null;
  let market = emitter;

  if (protocol === 'aave-v3') {
    asset = addressFromTopic(topic2);
    debtRaw = rawWord(eventWords[0]);
  } else if (protocol === 'benqi') {
    debtRaw = rawWord(eventWords[2]);
  } else if (protocol === 'euler-v2') {
    debtRaw = rawWord(eventWords[1]);
  } else if (protocol === 'silo-v2') {
    market = addressFromTopic(topic2);
    if (!market || !siloValidator(market)) return null;
    debtRaw = rawWord(eventWords[0]);
  } else if (protocol === 'aave-v4') {
    // V4 identifies reserves by numeric reserve IDs. Counts are exact, but value
    // attribution is intentionally withheld until the reserve-ID history is indexed.
    debtRaw = null;
  }

  if (protocol !== 'aave-v4' && debtRaw == null) return null;
  const transactionHash = String(log.tx_hash || log.transactionHash || '').toLowerCase() || null;
  const logIndex = Number(log.log_index ?? log.logIndex ?? 0);
  return {
    id: `${transactionHash}:${logIndex}`,
    date: log.date || null,
    protocol,
    blockNumber: Number(log.block_number ?? log.blockNumber),
    transactionHash,
    logIndex,
    emitter,
    market,
    asset,
    debtRaw,
    liquidator: addressFromTopic(topic1),
    borrower: protocol === 'silo-v2' ? addressFromTopic(topic3) : protocol === 'aave-v3' ? addressFromTopic(topic3) : null,
  };
}

export function decimalAmount(raw, decimals) {
  if (raw == null || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  try {
    const value = BigInt(raw);
    const scale = 10n ** BigInt(decimals);
    return Number(value / scale) + Number(value % scale) / Number(scale);
  } catch {
    return null;
  }
}

export function buildVaultMetric(rows = [], { observedAt = null, blockNumber = null, protocolCoverage = [] } = {}) {
  const validRows = rows.filter((row) => normalizedAddress(row.address) && normalizedAddress(row.asset));
  const included = validRows.filter((row) => row.includedInHeadline !== false && row.active);
  const priced = included.filter((row) => Number.isFinite(row.grossAssetsUsd));
  const borrowedPriced = included.filter((row) => Number.isFinite(row.borrowedUsd));
  const failedProtocols = protocolCoverage.filter((row) => row.state !== 'available');
  const state = !validRows.length ? 'unavailable' : failedProtocols.length || priced.length < included.length ? 'partial' : 'available';
  return {
    state,
    observedAt,
    blockNumber,
    grossAssetsUsd: priced.reduce((total, row) => total + row.grossAssetsUsd, 0),
    borrowedUsd: borrowedPriced.reduce((total, row) => total + row.borrowedUsd, 0),
    totalVaults: validRows.length,
    activeVaults: included.length,
    pricedActiveVaults: priced.length,
    unpricedActiveVaults: included.length - priced.length,
    rows: [...validRows].sort((a, b) => (b.grossAssetsUsd || 0) - (a.grossAssetsUsd || 0)),
    protocolCoverage,
    accounting: {
      kind: 'gross-factory-assets',
      additive: false,
      explanation: 'Current underlying assets held by permissionless factory vaults. Values are gross, may overlap economically, and are not net protocol TVL.',
    },
  };
}

export function buildLiquidationMetric(events = [], { dates = [], expectedProtocols = [], coveredProtocols = [], observedAt = null, eventCountsExact = false, limitation = null } = {}) {
  const unique = new Map();
  for (const event of events) if (event?.id && !unique.has(event.id)) unique.set(event.id, event);
  const rows = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  const history = dates.map((date) => {
    const daily = rows.filter((event) => event.date === date);
    const valued = daily.filter((event) => Number.isFinite(event.debtRepaidUsd));
    return {
      date,
      events: daily.length,
      debtRepaidUsd: valued.length ? valued.reduce((total, event) => total + event.debtRepaidUsd, 0) : daily.length ? null : 0,
      pricedEvents: valued.length,
    };
  });
  const protocols = expectedProtocols.map((protocol) => {
    const protocolEvents = rows.filter((event) => event.protocol === protocol);
    const valued = protocolEvents.filter((event) => Number.isFinite(event.debtRepaidUsd));
    return {
      protocol,
      events: protocolEvents.length,
      pricedEvents: valued.length,
      debtRepaidUsd: valued.length ? valued.reduce((total, event) => total + event.debtRepaidUsd, 0) : protocolEvents.length ? null : 0,
      state: coveredProtocols.includes(protocol) ? 'available' : 'unavailable',
    };
  });
  const pricedEvents = rows.filter((event) => Number.isFinite(event.debtRepaidUsd));
  const missingProtocols = expectedProtocols.filter((protocol) => !coveredProtocols.includes(protocol));
  return {
    state: coveredProtocols.length === 0 ? 'unavailable' : missingProtocols.length ? 'partial' : 'available',
    observedAt,
    totalEvents: rows.length,
    pricedEvents: pricedEvents.length,
    debtRepaidUsd: pricedEvents.reduce((total, event) => total + event.debtRepaidUsd, 0),
    valuationCoveragePct: rows.length ? pricedEvents.length / rows.length * 100 : 100,
    history,
    protocols,
    events: rows,
    coverage: {
      start: dates[0] || null,
      end: dates.at(-1) || null,
      days: dates.length,
      expectedProtocols,
      coveredProtocols,
      missingProtocols,
      eventCountsExact,
      limitation: limitation || (eventCountsExact ? null : 'Counts cover only the explicitly validated emitter registry and must not be read as protocol-wide completeness.'),
      valueMethod: 'Debt repaid is valued at the DefiLlama end-of-UTC-day token price; unavailable prices remain null and never become zero.',
    },
  };
}

const DAY_MS = 86_400_000;
const GATEWAY_SCHEMA = 'avalanche-gateway-tokenized-assets/v2';
const GATEWAY_REGISTRY_VERSION = 'avalanche-tokenized-assets-registry/2026-09-18';
const EXPECTED_ASSETS = Object.freeze({
  buidl: '0x53fc82f14f009009b440a706e31c9021e1196a2f',
  vbill: '0x7f4546ef315efc65336187fe3765ea779ac90183',
  acred: '0x7c64925002bfa705834b118a923e9911bee32875',
  secz: '0x5954ff4099ac47c4d6d098a9216f3278bb8c9506',
});

export function materializeCoveredActivityRows(dates, tokens, sparseRows) {
  const sparseByKey = new Map(sparseRows.map((row) => [`${row.date}:${row.address.toLowerCase()}`, row]));
  return dates.flatMap((date) => tokens.map((token) => sparseByKey.get(`${date}:${token.address.toLowerCase()}`) || ({
    date, address: token.address.toLowerCase(), transfers: 0, mint_events: 0, burn_events: 0,
    minted_raw: '0', burned_raw: '0', participant_sides: 0, explicitZero: true,
  })));
}

export function observationState({ ok, value, observedAt, now = Date.now(), staleAfterHours = 48, error = null }) {
  const ageMs = observedAt ? now - Date.parse(observedAt) : null;
  const stale = Number.isFinite(ageMs) && ageMs > staleAfterHours * 3_600_000;
  return {
    availability: ok && value != null ? (stale ? 'stale' : 'available') : 'unavailable',
    observedAt: observedAt || null,
    ageHours: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 36_000) / 100) : null,
    staleAfterHours,
    error: ok ? null : error || 'source unavailable',
  };
}

export function fieldFromSourceEnvelope(envelope, { previousValue = null, previousStatus = null, fallbackValue = null, sourceError = 'source unavailable' } = {}) {
  if (envelope?.value != null) {
    return {
      value: envelope.value,
      status: {
        availability: envelope.availability || 'available',
        observedAt: envelope.observedAt || null,
        error: envelope.error || null,
        retainedLastGood: Boolean(envelope.retainedLastGood),
      },
    };
  }
  if (envelope?.expired) {
    return {
      value: null,
      status: {
        availability: 'unavailable',
        observedAt: envelope.observedAt || null,
        error: envelope.error || sourceError,
        retainedLastGood: false,
        expired: Boolean(envelope.expired),
      },
    };
  }
  if (previousValue != null) {
    return {
      value: previousValue,
      status: {
        availability: 'stale',
        observedAt: previousStatus?.observedAt || null,
        error: envelope?.error || sourceError,
        retainedLastGood: true,
      },
    };
  }
  return {
    value: fallbackValue,
    status: {
      availability: 'unavailable',
      observedAt: envelope?.observedAt || null,
      error: envelope?.error || sourceError,
      retainedLastGood: false,
    },
  };
}

export function independentObservedField({ ok, value, fetchedAt, error, previousValue = null, previousStatus = null }) {
  return fieldFromSourceEnvelope(ok && value != null ? {
    value, observedAt: fetchedAt || null, availability: 'available', error: null, retainedLastGood: false,
  } : { value: null, observedAt: fetchedAt || null, availability: 'unavailable', error: error || 'source unavailable', retainedLastGood: false }, {
    previousValue, previousStatus, sourceError: error || 'source unavailable',
  });
}

export function preserveLastGood(current, previous, fields, observedAt, now = Date.now()) {
  const output = { ...current, fieldStatus: {} };
  for (const field of fields) {
    const fresh = current[field] != null;
    const fallback = previous?.[field] != null;
    output[field] = fresh ? current[field] : (fallback ? previous[field] : null);
    output.fieldStatus[field] = {
      ...observationState({
        ok: fresh,
        value: output[field],
        observedAt: fresh ? observedAt : previous?.fieldStatus?.[field]?.observedAt,
        now,
        error: current.errors?.[field] || null,
      }),
      availability: fresh
        ? observationState({ ok: true, value: output[field], observedAt, now }).availability
        : (fallback ? 'stale' : 'unavailable'),
      retainedLastGood: !fresh && fallback,
    };
  }
  return output;
}

export function composeTokenizedEvidence({ canonicalSnapshot = null, comparators = [] } = {}) {
  const valueHistory = (Array.isArray(canonicalSnapshot?.valueHistory) ? canonicalSnapshot.valueHistory : [])
    .filter((row) => typeof row?.date === 'string' && Number.isFinite(row.total))
    .map((row) => ({ ...row }));
  return {
    valueHistory,
    comparators: comparators.map((row) => ({ ...row })),
    rule: 'Only canonical observation-date history may populate valueHistory; comparator observations never backfill canonical values.',
  };
}

export function summarizeTokenized(assets, adapterTvlUsd) {
  const valued = assets.filter((row) => Number.isFinite(row.valueUsd));
  const holderRows = assets.filter((row) => Number.isFinite(row.holders));
  const valueUsd = valued.length ? valued.reduce((total, row) => total + row.valueUsd, 0) : null;
  const holders = holderRows.length ? holderRows.reduce((total, row) => total + row.holders, 0) : null;
  const includedAssetIds = valued.map((row) => row.id);
  const excludedAssetIds = assets.filter((row) => !valued.includes(row)).map((row) => row.id);
  return {
    verifiedTokenContracts: assets.length,
    trackedValueUsd: valueUsd,
    verifiedContractValueUsd: valueUsd,
    rwaAdapterTvlUsd: Number.isFinite(adapterTvlUsd) ? adapterTvlUsd : null,
    verifiedHolders: holders,
    valuedAssets: valued.length,
    holderAssets: holderRows.length,
    trackedAssets: assets.length,
    valueAvailability: valued.length === 0 ? 'unavailable' : (valued.length === assets.length ? 'available' : 'partial'),
    holderAvailability: holderRows.length === 0 ? 'unavailable' : (holderRows.length === assets.length ? 'available' : 'partial'),
    contractCoverage: `${assets.length}/${assets.length}`,
    valueCoverage: `${valued.length}/${assets.length}`,
    holderCoverage: `${holderRows.length}/${assets.length}`,
    includedAssetIds,
    excludedAssetIds,
  };
}

export function updateDashboardTokenizedFromGateway(dashboard, snapshot) {
  if (snapshot?.schemaVersion !== GATEWAY_SCHEMA || snapshot.registryVersion !== GATEWAY_REGISTRY_VERSION || !Array.isArray(snapshot.assets) || snapshot.assets.length !== 4) throw new Error('invalid canonical tokenized Gateway envelope');
  const canonicalById = new Map(snapshot.assets.map((row) => [row.id, row]));
  if (canonicalById.size !== 4 || Object.entries(EXPECTED_ASSETS).some(([id, address]) => canonicalById.get(id)?.address?.toLowerCase() !== address)) throw new Error('canonical tokenized Gateway registry mismatch');
  const previous = dashboard.tokenizedAssets || {};
  const previousAssets = new Map((previous.assets || []).map((row) => [row.id, row]));
  const assets = Object.keys(EXPECTED_ASSETS).map((id) => {
    const old = previousAssets.get(id) || { id, address: EXPECTED_ASSETS[id] };
    const canonical = canonicalById.get(id);
    const totalSupply = fieldFromSourceEnvelope(canonical.token?.totalSupply, { previousValue: old.totalSupply, previousStatus: old.fieldStatus?.totalSupply });
    const symbol = fieldFromSourceEnvelope(canonical.token?.symbol, { previousValue: old.symbol, previousStatus: old.fieldStatus?.symbol });
    const tokenName = fieldFromSourceEnvelope(canonical.token?.tokenName, { previousValue: old.tokenName, previousStatus: old.fieldStatus?.tokenName });
    const valueUsd = fieldFromSourceEnvelope(canonical.valueUsd, { previousValue: old.valueUsd, previousStatus: old.fieldStatus?.valueUsd });
    const valuationUsd = fieldFromSourceEnvelope(canonical.valuation, { previousValue: old.valuationUsd, previousStatus: old.fieldStatus?.valuationUsd });
    return {
      ...old,
      address: canonical.address,
      implementation: canonical.token?.implementation?.value || old.implementation || null,
      decimals: canonical.token?.decimals?.value ?? old.decimals ?? null,
      totalSupply: totalSupply.value,
      totalSupplyRaw: canonical.token?.totalSupplyRaw?.value ?? old.totalSupplyRaw ?? null,
      totalSupplyExact: canonical.token?.totalSupplyExact?.value ?? old.totalSupplyExact ?? null,
      symbol: symbol.value,
      tokenName: tokenName.value,
      valueUsd: valueUsd.value,
      valueUsdExact: canonical.valueUsd?.valueExact ?? old.valueUsdExact ?? null,
      valuationUsd: valuationUsd.value,
      valuationUsdExact: canonical.valuation?.valueExact ?? old.valuationUsdExact ?? null,
      valuationAnswerRaw: canonical.valuation?.answerRaw ?? canonical.valuation?.feed?.answerRaw ?? old.valuationAnswerRaw ?? null,
      fieldStatus: { ...old.fieldStatus, totalSupply: totalSupply.status, symbol: symbol.status, tokenName: tokenName.status, valueUsd: valueUsd.status, valuationUsd: valuationUsd.status },
      valuationFeed: canonical.valuation?.feed || null,
      supplementalFeeds: canonical.supplementalFeeds || [],
      valueStatus: canonical.valueUsd || null,
      tokenStatus: canonical.token || null,
      gatewayStatus: canonical.status,
      gatewayBlock: snapshot.block,
      valuationBasis: canonical.valuationBasis,
      observedAt: snapshot.block?.timestamp || null,
      supplyObservedAt: totalSupply.status.observedAt,
      valuationObservedAt: valuationUsd.status.observedAt,
      valueObservedAt: valueUsd.status.observedAt,
    };
  });
  const adapterTvlUsd = previous.kpis?.rwaAdapterTvlUsd ?? null;
  const kpis = summarizeTokenized(assets, adapterTvlUsd);
  Object.assign(kpis, {
    aggregateStatus: snapshot.aggregateStatus,
    aggregateLabel: snapshot.aggregateLabel,
    aggregateComplete: snapshot.aggregateEligibility?.complete === true,
    eligibleAssetIds: snapshot.aggregateEligibility?.eligibleAssetIds || [],
    excludedAssetIds: snapshot.aggregateEligibility?.excludedAssetIds || [],
  });
  const next = {
    ...dashboard,
    overview: { ...dashboard.overview, kpis: { ...dashboard.overview?.kpis, tokenizedAssetValueUsd: kpis.verifiedContractValueUsd } },
    tokenizedAssets: {
      ...previous,
      generatedAt: snapshot.generatedAt,
      kpis,
      assets,
      canonicalSnapshot: {
        source: snapshot.source, schemaVersion: snapshot.schemaVersion, registryVersion: snapshot.registryVersion,
        generatedAt: snapshot.generatedAt, block: snapshot.block, coverage: snapshot.coverage,
        aggregateValueUsd: snapshot.aggregateValueUsd, aggregateValueUsdExact: snapshot.aggregateValueUsdExact,
        aggregateStatus: snapshot.aggregateStatus, aggregateLabel: snapshot.aggregateLabel, aggregateEligibility: snapshot.aggregateEligibility,
      },
    },
  };
  const oldHealth = dashboard.quality?.sourceHealth || [];
  next.quality = { ...dashboard.quality, sourceHealth: [...oldHealth.filter((row) => row.id !== 'avalanche-gateway-tokenized-assets'), { id: 'avalanche-gateway-tokenized-assets', ok: true, fetchedAt: snapshot.generatedAt, observedAt: snapshot.block?.timestamp || null, availability: snapshot.coverage?.availability || 'unavailable', error: null }] };
  return next;
}

export function activityFreshness(activity, now = Date.now()) {
  const end = activity?.coverage?.end;
  const endMs = end ? Date.parse(`${end}T23:59:59Z`) : NaN;
  const lagDays = Number.isFinite(endMs) ? Math.max(0, Math.floor((now - endMs) / DAY_MS)) : null;
  return {
    availability: !Array.isArray(activity?.daily) ? 'unavailable' : (lagDays >= 2 ? 'stale' : 'available'),
    generatedAt: activity?.generatedAt || null,
    coverage: activity?.coverage || null,
    lagDays,
    limitation: activity?.note || 'Mint/burn event coverage is unavailable.',
  };
}

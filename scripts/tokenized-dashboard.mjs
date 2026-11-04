const DAY_MS = 86_400_000;

export function tokenizedStockVenueLandscape(now = Date.now()) {
  const rankingObservedAt = null;
  const rankingAgeMs = rankingObservedAt ? now - Date.parse(rankingObservedAt) : null;
  return {
    schema: 'couchdicks.avalanche.tokenized-stock-venues.v1',
    scope: 'Venue-level productive use of tokenized stocks; separate from native Avalanche issuance, verified contract value, and broader RWA adapter TVL.',
    ranking: {
      provider: 'Token Terminal',
      metric: 'Seven-day net deposits',
      window: 'rolling-7d',
      availability: rankingObservedAt == null ? 'unavailable' : (rankingAgeMs > DAY_MS ? 'stale' : 'available'),
      observedAt: rankingObservedAt,
      sourceUrl: 'https://tokenterminal.com/explorer/tokenized-assets/stocks',
      sourceLabel: 'Token Terminal · tokenized stocks explorer',
      entries: [],
      limitation: 'The ranking is live and rolling at the source. No source-observed venue values or observation timestamp are available in this snapshot, so ranks and net deposits are not copied or inferred.',
    },
    venues: [{
      id: 'pharaoh-tokenized-stocks',
      name: 'Pharaoh',
      chain: 'Avalanche',
      venueType: 'DEX',
      lifecycle: 'announced-not-live',
      availability: 'not-live',
      plan: 'Permissionless 24/7 trading of tokenized U.S. stocks',
      evidenceObservedAt: '2026-09-16T16:47:00Z',
      evidenceType: 'official-ecosystem-announcement',
      sourceUrl: 'https://x.com/avax/status/2100265352710037622',
      sourceLabel: 'Avalanche announcement',
      netDeposits7dUsd: null,
      volumeUsd: null,
      launchDate: null,
      tokenContracts: [],
      issuer: null,
      custody: null,
      regulatoryDetails: null,
      limitation: 'Announced plan only. The cited source says Pharaoh is planning the venue; it does not establish a live market or disclose launch timing, contracts, issuer, custody, regulatory details, deposits, or volume.',
    }],
  };
}

export function materializeCoveredActivityRows(dates, tokens, sparseRows) {
  const sparseByKey = new Map(sparseRows.map((row) => [`${row.date}:${row.address.toLowerCase()}`, row]));
  return dates.flatMap((date) => tokens.map((token) => sparseByKey.get(`${date}:${token.address.toLowerCase()}`) || ({
    date, address: token.address.toLowerCase(), transfers: 0, mint_events: 0, burn_events: 0,
    minted_raw: 0, burned_raw: 0, participant_sides: 0, explicitZero: true,
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
  if (envelope && envelope.availability === 'unavailable') {
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
  } : null, {
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
  const partialObservedValueUsd = valued.length ? valued.reduce((total, row) => total + row.valueUsd, 0) : null;
  const valueUsd = valued.length === assets.length ? partialObservedValueUsd : null;
  const holders = holderRows.length ? holderRows.reduce((total, row) => total + row.holders, 0) : null;
  const includedAssetIds = valued.map((row) => row.id);
  const excludedAssetIds = assets.filter((row) => !valued.includes(row)).map((row) => row.id);
  return {
    verifiedTokenContracts: assets.length,
    trackedValueUsd: valueUsd,
    partialObservedValueUsd,
    verifiedContractValueUsd: valueUsd,
    rwaAdapterTvlUsd: Number.isFinite(adapterTvlUsd) ? adapterTvlUsd : null,
    verifiedHolders: holders,
    valuedAssets: valued.length,
    holderAssets: holderRows.length,
    trackedAssets: assets.length,
    valueAvailability: valued.length === 0 ? 'unavailable' : (valued.length !== assets.length ? 'partial' : valued.some(row => ['stale', 'unavailable'].includes(row.fieldStatus?.valueUsd?.availability)) ? 'stale' : 'available'),
    holderAvailability: holderRows.length === 0 ? 'unavailable' : (holderRows.length !== assets.length ? 'partial' : holderRows.some(row => row.fieldStatus?.holders?.availability !== 'available') ? 'stale' : 'available'),
    contractCoverage: `${assets.length}/${assets.length}`,
    valueCoverage: `${valued.length}/${assets.length}`,
    holderCoverage: `${holderRows.length}/${assets.length}`,
    includedAssetIds,
    excludedAssetIds,
  };
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

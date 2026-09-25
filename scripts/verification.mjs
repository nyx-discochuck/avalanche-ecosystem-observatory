import { safeNumber } from './lib.mjs';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function sourceDate(value) {
  const match = String(value || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

function objectMetric(text, field) {
  const match = text.match(new RegExp(`"${field}":\\{"val":(-?[0-9.eE+]+|null)`));
  return match?.[1] === 'null' ? null : safeNumber(match?.[1]);
}

export function parseRwaAssetPage(html, { address, assetId, ticker, url, fetchedAt }) {
  const normalizedAddress = String(address || '').toLowerCase();
  const marker = `"address":"${normalizedAddress}"`;
  const addressIndex = String(html || '').toLowerCase().indexOf(marker);
  if (addressIndex < 0) throw new Error(`RWA.xyz page did not expose exact contract ${normalizedAddress}`);

  const objectStart = Math.max(0, String(html).lastIndexOf('{"id":', addressIndex));
  const objectEndCandidate = String(html).indexOf('},{"id":', addressIndex);
  const objectEnd = objectEndCandidate > addressIndex ? objectEndCandidate : Math.min(String(html).length, addressIndex + 80_000);
  const token = String(html).slice(objectStart, objectEnd);
  if (!/"network_name":"Avalanche C-Chain"/.test(token)) {
    throw new Error(`RWA.xyz contract ${normalizedAddress} is not scoped to Avalanche C-Chain`);
  }

  const supply = objectMetric(token, 'circulating_supply_token');
  const directValue = objectMetric(token, 'market_value_dollar');
  const nav = objectMetric(String(html), 'net_asset_value_dollar');
  const valueUsd = directValue ?? (finite(supply) && finite(nav) ? supply * nav : null);
  const asOfMatch = String(html).match(new RegExp(`${ticker}[^"]*last updated ([0-9/]+)`, 'i'))
    || String(html).match(/last updated ([0-9/]+)/i);

  return {
    assetId,
    ticker,
    address: normalizedAddress,
    network: 'Avalanche C-Chain',
    supply,
    navUsd: nav,
    valueUsd,
    sourceAsOf: sourceDate(asOfMatch?.[1]),
    fetchedAt,
    url,
  };
}

export function buildVerificationCheck({
  id,
  category,
  label,
  metricId,
  unit,
  observedValue,
  comparatorValue,
  observedLabel = 'Observatory',
  comparatorLabel,
  sourceId,
  sourceName,
  sourceUrl,
  sourceAsOf = null,
  fetchedAt = null,
  scope,
  comparability = 'exact',
  independence = 'independent',
  tolerancePct = null,
  note,
}) {
  const valuesAvailable = finite(observedValue) && finite(comparatorValue);
  const scored = comparability === 'exact' || comparability === 'qualified';
  const absoluteVariance = valuesAvailable ? Number(observedValue) - Number(comparatorValue) : null;
  const percentVariance = valuesAvailable && Number(comparatorValue) !== 0
    ? absoluteVariance / Math.abs(Number(comparatorValue)) * 100
    : null;

  let status = 'unavailable';
  if (valuesAvailable && !scored) status = 'context';
  if (valuesAvailable && scored && finite(percentVariance) && finite(tolerancePct)) {
    status = Math.abs(percentVariance) <= Number(tolerancePct) ? 'pass' : 'review';
  }

  return {
    id,
    category,
    label,
    metricId,
    unit,
    observed: { label: observedLabel, value: finite(observedValue) ? Number(observedValue) : null },
    comparator: {
      label: comparatorLabel,
      value: finite(comparatorValue) ? Number(comparatorValue) : null,
      sourceId,
      sourceName,
      url: sourceUrl,
      sourceAsOf,
      fetchedAt,
    },
    scope,
    comparability,
    independence,
    tolerancePct: scored && finite(tolerancePct) ? Number(tolerancePct) : null,
    absoluteVariance,
    percentVariance,
    status,
    note,
  };
}

export function summarizeVerification(checks) {
  const counts = Object.fromEntries(['pass', 'review', 'context', 'unavailable'].map((status) => [
    status,
    checks.filter((check) => check.status === status).length,
  ]));
  const scored = counts.pass + counts.review;
  return {
    total: checks.length,
    scored,
    ...counts,
    passRatePct: scored ? counts.pass / scored * 100 : null,
    // This describes the result of the checks that were actually scored. It is
    // deliberately not a dashboard/source-health signal because optional
    // comparators may be unavailable without affecting canonical metrics.
    status: counts.review ? 'review' : scored ? 'matched' : 'unavailable',
  };
}

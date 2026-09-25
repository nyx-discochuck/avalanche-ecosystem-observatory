const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const preciseAvax = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 8,
});

export function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatAvax(value) {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000) return compact.format(value);
  if (magnitude >= 0.001) return decimal.format(value);
  if (magnitude >= 0.00000001 || magnitude === 0) return preciseAvax.format(value);
  return value.toExponential(3);
}

export function formatValue(value, unit = 'USD') {
  if (!finite(value)) return 'Unavailable';
  if (unit === 'USD') return `$${compact.format(value)}`;
  if (unit === 'percent') return `${decimal.format(value)}%`;
  if (unit === 'AVAX') return `${formatAvax(value)} AVAX`;
  if (unit === 'Gwei') return `${decimal.format(value)} Gwei`;
  if (unit === 'TPS') return `${decimal.format(value)} TPS`;
  if (unit === 'address' || unit === 'contracts' || unit === 'transactions') return compact.format(value);
  return compact.format(value);
}

const PHARAOH_SOURCE = /^pharaoh(?:\s|$)/i;

export function combineDexLiquiditySources(rows = []) {
  return rows.map((row) => {
    const combined = {};
    let pharaohVolume = 0;
    let hasPharaohVolume = false;

    for (const [key, value] of Object.entries(row || {})) {
      if (key === 'date') {
        combined.date = value;
        continue;
      }

      if (!PHARAOH_SOURCE.test(key)) {
        combined[key] = value;
        continue;
      }

      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      pharaohVolume += numeric;
      hasPharaohVolume = true;
    }

    if (hasPharaohVolume) combined.Pharaoh = pharaohVolume;
    return combined;
  });
}

export function rankDexLiquiditySourceKeys(rows = []) {
  const totals = new Map();
  const firstSeen = new Map();

  for (const row of rows) {
    for (const [key, value] of Object.entries(row || {})) {
      if (key === 'date') continue;
      if (!firstSeen.has(key)) firstSeen.set(key, firstSeen.size);
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      totals.set(key, (totals.get(key) || 0) + numeric);
    }
  }

  return [...firstSeen.keys()].sort((left, right) => (
    (totals.get(right) || 0) - (totals.get(left) || 0)
    || firstSeen.get(left) - firstSeen.get(right)
  ));
}

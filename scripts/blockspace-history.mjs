const DAY_MS = 86_400_000;

function validDay(row) {
  return row && /^\d{4}-\d{2}-\d{2}$/.test(row.date || '') && Number.isFinite(Date.parse(`${row.date}T00:00:00Z`));
}

export function mergeBlockspaceDaily(previousRows = [], rederivedRows = []) {
  const byDate = new Map();
  for (const row of previousRows) if (validDay(row) && row.partial !== true) byDate.set(row.date, { ...row });
  for (const row of rederivedRows) if (validDay(row) && row.partial !== true) byDate.set(row.date, { ...row });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function blockspaceCoverage(daily, { rederivedDates = [] } = {}) {
  const dates = daily.map((row) => row.date).filter(Boolean).sort();
  const rederived = new Set(rederivedDates);
  let contiguous = true;
  for (let index = 1; index < dates.length; index += 1) {
    if (Date.parse(`${dates[index]}T00:00:00Z`) - Date.parse(`${dates[index - 1]}T00:00:00Z`) !== DAY_MS) { contiguous = false; break; }
  }
  const rederivedDays = dates.filter((date) => rederived.has(date)).length;
  return {
    start: dates[0] || null,
    end: dates.at(-1) || null,
    days: dates.length,
    completeDaysOnly: daily.every((row) => row.partial !== true),
    contiguous,
    retainedDays: Math.max(0, dates.length - rederivedDays),
    rederivedDays,
    rederivedStart: rederivedDates[0] || null,
    rederivedEnd: rederivedDates.at(-1) || null,
  };
}

export function extractBlockspaceDaily(payload) {
  const blockspace = payload?.blockspace || payload;
  return Array.isArray(blockspace?.daily) ? blockspace.daily : [];
}

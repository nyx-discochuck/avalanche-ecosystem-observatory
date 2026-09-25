import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { blockspaceCoverage, extractBlockspaceDaily, mergeBlockspaceDaily } from '../scripts/blockspace-history.mjs';

function day(date, transactions, extra = {}) { return { date, transactions, blocks: 1, partial: false, ...extra }; }

test('retained longer history survives a shorter rederived archive window', () => {
  const previous = [
    day('2026-08-18', 1), day('2026-09-10', 10), day('2026-09-11', 11),
    day('2026-09-12', 12), day('2026-09-13', 13), day('2026-09-14', 14),
    day('2026-09-15', 15), day('2026-09-16', 16),
  ];
  const rederived = [day('2026-09-11', 111), day('2026-09-12', 112), day('2026-09-13', 113), day('2026-09-14', 114), day('2026-09-15', 115), day('2026-09-16', 116), day('2026-09-17', 117)];
  const merged = mergeBlockspaceDaily(previous, rederived);
  assert.equal(merged.length, 9);
  assert.equal(merged.find((row) => row.date === '2026-08-18').transactions, 1);
  assert.equal(merged.find((row) => row.date === '2026-09-11').transactions, 111);
  assert.equal(merged.at(-1).date, '2026-09-17');
  const coverage = blockspaceCoverage(merged, { rederivedDates: rederived.map((row) => row.date) });
  assert.deepEqual({ start: coverage.start, end: coverage.end, days: coverage.days, retainedDays: coverage.retainedDays, rederivedDays: coverage.rederivedDays }, { start: '2026-08-18', end: '2026-09-17', days: 9, retainedDays: 2, rederivedDays: 7 });
  assert.equal(coverage.contiguous, false);
  assert.equal(coverage.completeDaysOnly, true);
});

test('partial or malformed historical rows cannot be promoted into complete history', () => {
  const merged = mergeBlockspaceDaily([day('2026-09-10', 1), day('2026-09-11', 2, { partial: true }), { date: 'bad', partial: false }], [day('2026-09-11', 3)]);
  assert.deepEqual(merged.map((row) => [row.date, row.transactions]), [['2026-09-10', 1], ['2026-09-11', 3]]);
  assert.deepEqual(extractBlockspaceDaily({ blockspace: { daily: merged } }), merged);
});

test('collector supports an explicit healthy history seed and publishes truthful retained/source-window coverage', async () => {
  const source = await readFile(new URL('../scripts/collect-blockspace.mjs', import.meta.url), 'utf8');
  assert.match(source, /BLOCKSPACE_HISTORY_SEED/);
  assert.match(source, /mergeBlockspaceDaily\(previousDaily, daily\)/);
  assert.match(source, /sourceWindow/);
  assert.match(source, /topContractsCoverage/);
  assert.match(source, /retentionPolicy/);
});

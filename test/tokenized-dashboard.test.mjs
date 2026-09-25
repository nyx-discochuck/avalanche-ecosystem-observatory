import test from 'node:test';
import assert from 'node:assert/strict';
import { activityFreshness, fieldFromSourceEnvelope, independentObservedField, materializeCoveredActivityRows, observationState, preserveLastGood, summarizeTokenized } from '../scripts/tokenized-dashboard.mjs';

const now = Date.parse('2026-09-18T12:00:00Z');

test('failed fields retain last-good values and original observation timestamps', () => {
  const previous = { holders: 12, fieldStatus: { holders: { observedAt: '2026-09-16T10:00:00Z' } } };
  const row = preserveLastGood({ holders: null, errors: { holders: '429' } }, previous, ['holders'], '2026-09-18T12:00:00Z', now);
  assert.equal(row.holders, 12);
  assert.equal(row.fieldStatus.holders.availability, 'stale');
  assert.equal(row.fieldStatus.holders.retainedLastGood, true);
  assert.equal(row.fieldStatus.holders.observedAt, '2026-09-16T10:00:00Z');
  assert.equal(row.fieldStatus.holders.error, '429');
});

test('Gateway-retained value remains stale with its source timestamp', () => {
  const mapped = fieldFromSourceEnvelope({ value: 250, observedAt: '2026-09-16T08:00:00Z', availability: 'stale', error: 'feed timeout', retainedLastGood: true }, {
    previousValue: 240,
    previousStatus: { observedAt: '2026-09-15T08:00:00Z' },
  });
  assert.equal(mapped.value, 250);
  assert.deepEqual(mapped.status, { availability: 'stale', observedAt: '2026-09-16T08:00:00Z', error: 'feed timeout', retainedLastGood: true });
});

test('holder timestamps are independent and failed holders retain their original observation', () => {
  const fresh = independentObservedField({ ok: true, value: 19, fetchedAt: '2026-09-18T12:03:00Z' });
  assert.equal(fresh.status.observedAt, '2026-09-18T12:03:00Z');
  const retained = independentObservedField({ ok: false, value: null, fetchedAt: '2026-09-18T12:05:00Z', error: '429', previousValue: 19, previousStatus: fresh.status });
  assert.equal(retained.value, 19);
  assert.equal(retained.status.observedAt, '2026-09-18T12:03:00Z');
  assert.equal(retained.status.availability, 'stale');
  assert.equal(retained.status.retainedLastGood, true);
});

test('missing holder observations are unavailable rather than a fabricated zero', () => {
  const summary = summarizeTokenized([{ id: 'a', valueUsd: 10, holders: null }, { id: 'b', valueUsd: null, holders: null }], 25);
  assert.equal(summary.verifiedHolders, null);
  assert.equal(summary.holderAvailability, 'unavailable');
  assert.equal(summary.valueAvailability, 'partial');
  assert.equal(summary.verifiedContractValueUsd, 10);
});

test('freshness exposes stale activity and partial source state', () => {
  assert.equal(observationState({ ok: true, value: 1, observedAt: '2026-09-15T00:00:00Z', now }).availability, 'stale');
  const activity = activityFreshness({ generatedAt: '2026-09-16T01:00:00Z', coverage: { start: '2026-08-17', end: '2026-09-15' }, daily: [], note: 'bounded events' }, now);
  assert.equal(activity.availability, 'stale');
  assert.equal(activity.limitation, 'bounded events');
});

test('fully covered archive dates emit explicit per-contract zeros without inventing outside dates', () => {
  const tokens = [{ address: '0xAA' }, { address: '0xBB' }];
  const rows = materializeCoveredActivityRows(['2026-09-11', '2026-09-12'], tokens, [{ date: '2026-09-11', address: '0xaa', mint_events: 1 }]);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].mint_events, 1);
  assert.equal(rows[1].explicitZero, true);
  assert.equal(rows[2].explicitZero, true);
  assert.equal(rows.some((row) => row.date === '2026-09-10'), false);
});

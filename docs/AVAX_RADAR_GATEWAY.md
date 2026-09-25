# AVAX Radar Indexing and Gateway Architecture

## Scope and ownership boundary

`avax-radar` is a separately operated Avalanche C-Chain indexer and Gateway. Its source informed this description, but its runtime, database, endpoint pool, credentials, deployment configuration, and production data are **not** part of this repository. The Observatory can consume a small HTTP contract from that service when `AVAX_RADAR_URL` is configured; it does not need the Gateway to build, test, serve the committed snapshots, or run its static/offline path.

This document describes the transferable design rather than a production topology. It intentionally excludes private endpoints, credentials, host paths, database connection strings, infrastructure layout, and production-only data.

## Data flow at a glance

```text
public C-Chain RPCs
  -> bounded endpoint race and health/cooldown state
  -> log lane (primary) + bounded block lane (supporting context)
  -> idempotent database facts and independent lane checkpoints
  -> selective receipt enrichment
  -> confirmation-delayed, validated materializers
  -> atomic Gateway-owned snapshots / bounded HTTP APIs
  -> Observatory adapter (timeout, normalization, fail-open UI)
```

The central design choice is **log-first ingestion**. Routine ERC-20 activity comes from block-range `eth_getLogs` calls, not a receipt request for every transaction. Blocks and receipts remain useful, but they are bounded supporting lanes rather than the ingestion backbone.

## RPC endpoint racing, health, and cooldowns

The RPC pool accepts a configured set of endpoints and applies four controls:

1. Every request has an abort timeout.
2. Only a bounded number of endpoints participate in a race; the first successful response wins.
3. Eligible endpoints are ordered by their last observed latency, with stable configuration order as the tie-breaker.
4. A failed endpoint records its error and failure time and enters a cooldown. Healthy endpoints are preferred; if all are cooling down, the pool chooses those nearest to recovery so the collector can probe forward rather than deadlock.

The in-memory health snapshot includes race width, timeout, endpoint count, wins, failures, latency, last success/failure, last error, and cooldown state. It is operational evidence, not a consensus proof: racing improves availability and latency but does not establish that independently operated RPCs agree. Confirmation delay, pinned blocks, validation, and block-hash revalidation provide separate integrity controls where needed.

Batch receipt work deliberately selects a preferred healthy endpoint and submits bounded JSON-RPC chunks. It does not multiply every receipt batch across the full pool. This limits rate pressure while retaining fail-fast health accounting.

## Ingestion lanes

### 1. Log-first lane

The primary lane splits an assigned inclusive block span into bounded ranges and requests ERC-20 `Transfer` logs and known swap topics with `eth_getLogs`. A failed log request is retried with exponential delay, while each attempt still benefits from the RPC race policy.

Transfer logs are normalized into chain ID, block number, transaction hash, log index, token, sender, recipient, and raw integer amount. Swap event facts are retained separately and materialized only after transfer and transaction context is present. Database uniqueness keys and conflict-safe inserts make replay safe: repeating a completed or partially completed range does not duplicate the same transaction/log fact.

Only after the range writes and swap materialization succeed does the lane advance `collector.logs.last_block`. This makes the lane resumable. It is important not to overstate the guarantee: all writes and the checkpoint are not one database transaction in the current implementation. A process failure between them can leave facts ahead of the checkpoint; idempotent replay is the recovery mechanism.

### 2. Bounded block lane

The supporting block lane builds an explicit finite list of block numbers and fetches it with bounded worker concurrency. It records block hash, timestamp, transaction count, and the transaction sender/target context needed by downstream swap attribution. When enabled, it also extracts positive-value native transfers from block transaction bodies.

The orchestrator caps each live run to a configured maximum span and runs the block lane before the log lane because swap materialization needs block time and transaction context. The block and native lanes advance their own checkpoints only after their writes complete. Their upserts are replay-safe, so a later log-lane failure can retry the same overall range.

### 3. Selective receipt enrichment

Receipts are reserved for transactions admitted by explicit rules rather than fetched for all activity. Current candidate rules include a configurable large-transfer threshold and contact with watched contracts. A hard candidate limit bounds each range, and receipts are fetched in bounded JSON-RPC batches.

Receipt decoding records useful evidence such as status, gas used, matched contracts, and proxy upgrade/admin events. Registry classification separates expected routine activity, watched high-risk contracts, and novel contracts. Rows are retained only when they provide watched or novel contract evidence. The enrichment lane has its own checkpoint and can be disabled without stopping primary transfer ingestion.

## Checkpoints, ordering, and idempotence

Lane state uses independent keys such as:

- `collector.logs.last_block`
- `collector.blocks.last_block`
- `collector.native.last_block`
- `collector.enrichment.last_block`

Independent cursors prevent a slower optional lane from falsely claiming progress for another. For a normal run, the next log start is the last completed log block plus one; the safe end is the RPC tip minus confirmations and is capped by the maximum run span. Fixed start/end overrides exist for controlled benchmarks.

An implementation should preserve three invariants:

1. Persist normalized facts with stable natural keys and conflict-safe upserts.
2. Advance a lane cursor only after that lane's required writes and derivations succeed.
3. Treat replay as normal recovery, not as an exceptional repair procedure.

Do not combine lane cursors into a single optimistic “last block,” and do not advance a cursor in a `finally` block.

## Materialization and atomic publication

Gateway materializers are downstream of indexed facts and have stricter publication rules than raw ingestion. The tokenized-assets materializer is representative:

- select a block at least one confirmation behind the observed head;
- pin every contract and feed read to that block tag;
- reject stale or future-dated block/feed observations;
- verify contract code and immutable identity fields;
- calculate scaled values with exact integer/decimal arithmetic;
- re-read the pinned block and reject publication if its hash changed;
- validate the complete snapshot schema and invariants;
- write a process-unique temporary file and rename it into place.

The rename means readers see either the previous complete snapshot or the new complete snapshot, never a partially written JSON document. A failed refresh removes its temporary file and leaves the prior publication intact.

Some fields may retain a last-known-good value for a bounded period when a transient read fails. Every retained field is marked stale, carries its observation time and expiry, and becomes unavailable after expiry. Integrity failures such as identity mismatch are not hidden by retention. Serve-time freshness is recomputed, so an old file cannot remain “available” merely because it was valid when written.

## Consumer boundary in this repository

The Observatory's `radar-adapter.mjs` is an anti-corruption layer, not a shared database client. It requests only the Gateway's health, recent alerts, and recent heartbeats over HTTP, in parallel, under one bounded timeout. It normalizes those responses into `couchdicks.avalanche.radar.v1` and applies its own maximum-age rule.

The adapter deliberately exposes a narrow set of operational fields: synchronization time and block, RPC tip and lag, RPC posture/failover counts, recent transfer counts, and bounded recent activity arrays. The browser never receives Gateway database credentials or direct RPC control.

Failure is **fail-open for the Observatory**. A timeout, non-success response, malformed health contract, stale collector, or unavailable Gateway becomes an explicit unavailable/degraded radar payload. It does not mutate audited snapshots, trigger historical scans in an HTTP request, fabricate zeros, or prevent the rest of the dashboard from loading. The last in-process adapter result is inspectable via `peek`, but `get` returns the current attempt's normalized success or explicit failure state.

## Observability and failure behavior

Operators should be able to distinguish throughput, lag, source health, and publication freshness. The collector emits a structured per-range summary containing:

- start/end/safe-tip and checkpoint-before values;
- range size, elapsed time, blocks per second, and logs per second;
- raw and normalized row counts by lane;
- enrichment candidate and persisted counts;
- endpoint wins, failures, latency, errors, and cooldown posture.

Expected failure behavior is deterministic:

- **One RPC fails:** mark it unhealthy, cool it down, and accept another successful racer.
- **All RPC attempts fail:** do not advance the active lane checkpoint; exit non-zero and replay later.
- **Block lane succeeds, log lane fails:** retained block/context upserts are safe; retry the range from the unchanged log checkpoint.
- **Enrichment fails:** primary facts remain idempotent; its independent checkpoint does not advance.
- **Materializer validation or hash recheck fails:** publish nothing and continue serving the previous valid snapshot.
- **Gateway is stale or unreachable:** the Observatory labels radar unavailable/degraded while static and audited views continue to work.

Alerts should be based on lag, age, error rate, cooldown saturation, and repeated publication failure—not on a process merely being alive. Logs and health responses must redact connection strings and must not serialize authorization headers or private endpoint URLs.

## Security and privacy exclusions

The architecture indexes public-chain facts and publishes bounded derived observations. It does **not** require private keys, signing capability, wallet custody, user authentication secrets, or browser access to the backing database. Transaction addresses are public chain identifiers, but implementations should still minimize collection and avoid attaching off-chain identity, account data, IP addresses, or unrelated request metadata.

Public documentation and fixtures must use placeholders or public references only. Never commit credentials, private RPC URLs, database URLs, internal hostnames, host-specific filesystem paths, infrastructure inventories, raw production logs, production row samples, or production-only alert data. Gateway administrative and collection interfaces should remain outside the public consumer contract.

## Implementation handoff checklist

### RPC and range planning

- [ ] Accept an operator-supplied endpoint set without embedding private endpoints.
- [ ] Enforce request timeout, bounded race width, latency ordering, failure counters, and cooldowns.
- [ ] Select a confirmation-delayed safe tip and cap the blocks processed per run.
- [ ] Bound `eth_getLogs` ranges and retry transient failures with backoff.

### Persistence and lanes

- [ ] Use stable natural uniqueness keys for blocks, logs, transfers, swaps, and enrichments.
- [ ] Make every range replay-safe before enabling checkpoint advancement.
- [ ] Keep log, block, native, and enrichment checkpoints independent.
- [ ] Run required block/transaction context before dependent swap materialization.
- [ ] Limit receipt candidates and receipt batch size; keep enrichment optional.
- [ ] Add crash tests for “facts written, checkpoint not written” replay.

### Materializers and publication

- [ ] Pin all related reads to one confirmation-delayed block.
- [ ] Validate block age, contract identity, feed identity/freshness, arithmetic, and output schema.
- [ ] Revalidate the pinned block hash immediately before publication.
- [ ] Mark bounded retained values stale and expire them again at serve time.
- [ ] Publish through validate → temporary file → atomic rename; preserve the prior snapshot on failure.

### Consumer and operations

- [ ] Expose a versioned, bounded HTTP contract rather than database access.
- [ ] Apply consumer-side timeout and freshness checks; represent missing values as unavailable, never zero.
- [ ] Verify Gateway failure cannot block static snapshots or audited metrics.
- [ ] Emit per-lane throughput, lag, checkpoint, materializer freshness, and redacted endpoint-health metrics.
- [ ] Test one-endpoint failure, all-endpoint failure, partial-lane failure, stale snapshot, malformed response, timeout, and recovery.
- [ ] Review documentation and fixtures for secrets, private endpoints, host paths, topology, and production data before release.

## Source map for maintainers

The behavior above was grounded in the separately operated source modules `src/lib/rpc-pool.js`, `src/lib/collector-log-ingest.js`, `src/lib/collector-block-ingest.js`, `src/lib/collector-selective-enrichment.js`, `src/lib/postgres-store.js`, `src/lib/gateway-tokenized-assets.js`, and `scripts/collector-batched.mjs`. In this repository, the consumer boundary is implemented by [`../radar-adapter.mjs`](../radar-adapter.mjs), with behavior covered by `test/radar-adapter.test.mjs`.

See also [Architecture](ARCHITECTURE.md), [Indexing and scheduled jobs](INDEXING.md), [Publication](PUBLICATION.md), and [Validation](VALIDATION.md).

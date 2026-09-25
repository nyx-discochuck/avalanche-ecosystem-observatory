# Architecture

## Boundary

This repository owns only the Avalanche Ecosystem Observatory at `/avalanche/ecosystem/`. It has no runtime, code, data, deployment, or routing dependency on `robinhood-aggregators`, `avax-aggregators`, `avax-aggregators.couchdicks.org`, or aggregator-attribution projects.

## Components

1. **Primary derivation**: `collect-blockspace.mjs`, `collect-tokenized.mjs`, and `collect-lending.mjs` scan complete daily Avalanche parquet partitions with DuckDB. Lending also discovers Euler factory vaults and the union of Silo's pinned deployment registry plus current factory, then reads protocol-native rates and accounting from official lenses at one quorum-selected fixed block.
2. **Aggregate refresh**: `collect.mjs` fetches public RPC state and independent APIs concurrently, normalizes classifications, reconciles lending accounting, and merges on-chain derivations.
3. **Atomic publication**: runtime snapshots are written to a temporary path, synced, and renamed into ignored `state/*.json` files. A failed refresh leaves the last valid snapshot intact. Tracked `public/data` files are release-time fallbacks only.
4. **Runtime**: `server.mjs` serves the immutable Vite build and cached runtime JSON, falling back to the release snapshot on a fresh checkout. `/api/live` maintains a bounded 12-block RPC pulse with a 10-second server cache and current market/aggregate observations with a 60-second cache. It does not perform historical scans during a request.
5. **Client**: React and Recharts render seven sections from one audited snapshot plus the separately labeled live pulse. The browser refreshes the pulse every 12 seconds and revalidates the audited snapshot every minute while visible. Headline historical KPIs remain latest complete-observation values while the shared timeframe controls time series.
6. **Unified data plane**: `/api/radar` consumes AVAX Radar health, indexed transfer counts, and recent scored activity over loopback with a bounded timeout. Radar is supplemental and fail-open: an outage renders an explicit unavailable state without mutating audited snapshots or blocking the dashboard.
6. **Scheduling**: a user systemd timer runs the aggregate collector hourly. Daily parquet availability controls the latest complete on-chain date.

The secondary Sites build uses `deploy/sites/worker.mjs` and a root-based Vite client. It serves the tracked release snapshot and an equivalent direct live-pulse route. Hourly audited indexing remains VPS-only; Sites reports `mode: release-snapshot` in health output.

## Failure Model

- Each remote source records success, latency, timestamp, and error.
- Unavailable values remain `null`; unsupported series remain empty with a typed coverage explanation.
- The API exposes snapshot age and source health at `/api/health`.
- Live-source failures degrade `/api/live` without mutating or invalidating the audited snapshot.
- The runtime keeps serving the last successful snapshot during remote failure.
- Reorg safety is inherited from complete daily archive publication; the current partial UTC day is excluded.

## Security

The server binds to loopback and is exposed only through the Couchdicks catalog proxy. CSP, frame denial, MIME sniffing protection, method allowlisting, path normalization, and immutable asset caching are enabled. Secrets, when added, stay in the server-only `.env`, which is gitignored.

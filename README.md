# Avalanche Ecosystem Observatory

An open-source Avalanche C-Chain analytics dashboard with auditable metric definitions, source registries, collectors, and source-backed public snapshots.

## Quick start

Requires Node.js 22 or newer.

```bash
npm ci
npm run check
npm test
npm run build
npm run serve
```

Open `http://127.0.0.1:8876/avalanche/ecosystem/`. The committed files in `public/data/` let the dashboard and API run without private infrastructure or a fresh collection. Copy `.env.example` to `.env` only when you need to override defaults.

## Data and optional Gateway

The repository contains validated public snapshots for blockspace, lending, and tokenized-asset views. `public/data/dashboard.json` is the server fallback when no runtime `state/dashboard.json` exists.

Advanced lending and tokenized-asset collection requires a local parquet archive, configured with `AVACACHE_DIR`. Near-tip radar and other advanced observations can depend on a separately operated Avalanche Gateway, configured with `AVAX_RADAR_URL`. That Gateway is not included in this repository; when it is absent, the UI keeps serving committed snapshots and marks gateway-backed live features unavailable rather than inventing data. See the [AVAX Radar indexing and Gateway architecture](docs/AVAX_RADAR_GATEWAY.md) for the source-grounded design and implementation handoff.

To refresh data, review [data sources](docs/DATA_SOURCES.md), [methodology](docs/METHODOLOGY.md), and [indexing](docs/INDEXING.md), then run the relevant `collect:*` command. Collectors write ignored runtime state; publish a reviewed snapshot with `npm run snapshot:publish`.

## Project map

- `src/`: React dashboard and analytical views
- `server.mjs`: static server and JSON APIs
- `scripts/`: collectors, validators, and snapshot tooling
- `config/`: protocol, contract, source, and metric registries
- `public/data/`: committed, validated static snapshots
- `test/`: Node test suite
- `docs/`: architecture, methodology, validation, and operations
- `deploy/`: sanitized deployment examples only

The frontend and API support both root paths and the production-compatible `/avalanche/ecosystem/` prefix. No RPC credentials, private keys, administrative endpoints, or production deployment state are required or committed.

## Development

```bash
npm run dev       # Vite development server
npm run check     # configuration and syntax validation
npm test          # complete test suite
npm run build     # production bundle
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [the architecture guide](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE). Snapshot data retains the provenance and source terms documented in the project; verify upstream terms before redistributing derived datasets.

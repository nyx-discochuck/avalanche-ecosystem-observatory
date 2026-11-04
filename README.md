# Avalanche Ecosystem Observatory

Avalanche C-Chain analytics at `/avalanche/ecosystem/`, built as a separate project from every aggregator-attribution dashboard. The application follows the information architecture and dense analytical workflow of the ArbData ecosystem reference while using an original Avalanche/Couchdicks presentation and Avalanche-native accounting.

## Run

```bash
npm ci
npm run collect
npm run snapshot:publish
npm run build
npm run serve
```

The production server listens on `127.0.0.1:8876` by default. The frontend and JSON API are available with and without the production prefix:

- `/avalanche/ecosystem/`
- `/avalanche/ecosystem/api/dashboard`
- `/avalanche/ecosystem/api/live`
- `/avalanche/ecosystem/api/radar`
- `/avalanche/ecosystem/api/catalog`
- `/avalanche/ecosystem/api/health`

## Project Map

- `src/`: seven dashboard sections, a live network pulse, and shared interactive components
- Live pulse: a cached 12-block C-Chain window plus current AVAX, TVL, and partial UTC-day DEX observations; the browser revalidates automatically
- Verification Desk: scope-aware checks against RWA.xyz, Avalanche Metrics API, DeFiLlama companion endpoints, and independent AVAX market data
- `scripts/`: resumable collectors, validation, and health checks
- Lending evidence: fixed-block Euler UtilsLens APY and SiloLens APR/accounting from official factory/registry inventories, plus 30 complete days of Aave, BENQI, Euler, and factory-validated Silo liquidation events
- `config/protocol-registry.json`: machine-readable protocol and contract registry
- `config/lending-onchain.json`: official lending factories, pools, spokes, and event scope
- `config/metric-catalog.json`: auditable definitions and calculation rules
- `config/sources.json`: source inventory and confidence
- `public/data/`: tracked, validated release snapshots for static fallback
- `state/`: ignored runtime snapshots, checkpoints, and private collector state
- `deploy/systemd/`: isolated runtime and refresh units
- `docs/`: architecture, data, methodology, validation, operations, and limitations

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Data sources and registry](docs/DATA_SOURCES.md)
- [Methodology](docs/METHODOLOGY.md)
- [Indexing](docs/INDEXING.md)
- [Validation and reconciliation](docs/VALIDATION.md)
- [Operations and recovery](docs/OPERATIONS.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)

No RPC credentials, API keys, private keys, or administrative endpoints are bundled into the client. Optional server-side values are documented in `.env.example`.

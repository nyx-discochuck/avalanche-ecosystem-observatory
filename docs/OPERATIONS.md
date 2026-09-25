# Operations

## Local production-mode run

```bash
git clone <repository-url>
cd avalanche-ecosystem-observatory
npm ci
npm run check && npm test && npm run build
npm run serve
```

The server binds to `127.0.0.1:8876` by default. Override `HOST` and `PORT` in a local `.env` or process manager. Environment files and runtime `state/*.json` are ignored.

## Collection

The checked-in snapshot is sufficient to run the UI. Historical blockspace and tokenized-asset collection additionally needs a parquet archive at `AVACACHE_DIR`; advanced live features may use a separately managed Gateway at `AVAX_RADAR_URL`. These services and datasets are not bundled.

```bash
npm run collect
npm run snapshot:publish
npm run build
```

Review generated data before publishing it. Never commit `.env`, private runtime state, credentials, raw private datasets, or rollback archives.

## Monitoring

```bash
curl -fsS http://127.0.0.1:8876/api/health
curl -fsS http://127.0.0.1:8876/api/live
npm run healthcheck
```

`/api/live` is independent of snapshot freshness. Optional comparator or Gateway outages can degrade live checks while the dashboard continues to serve its last validated snapshot.

## Deployment example

Files under `deploy/` are examples, not production configuration. Replace every `__APP_DIR__` placeholder with an absolute path, review service hardening and permissions for your host, and install units under your own service manager. Keep TLS and reverse-proxy configuration outside this repository and route the chosen public prefix to the configured local port.

Before a release, retain the previous artifact and public snapshot, run all verification commands, deploy atomically, then verify the health and dashboard endpoints. Roll back by restoring those retained artifacts; this repository intentionally contains no host-specific backup locations or service-control automation.

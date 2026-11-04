# Operations, Recovery, and Rollback

## Install

```bash
cd /home/openclaw/avalanche-ecosystem-dashboard
npm ci
npm run collect
npm run snapshot:publish
npm run build
install -m 0644 deploy/systemd/avalanche-ecosystem-dashboard.service ~/.config/systemd/user/
install -m 0644 deploy/systemd/avalanche-ecosystem-collector.service ~/.config/systemd/user/
install -m 0644 deploy/systemd/avalanche-ecosystem-collector.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now avalanche-ecosystem-dashboard.service avalanche-ecosystem-collector.timer
```

The Couchdicks catalog receives one explicit proxy:

```text
['/avalanche/ecosystem/', 'http://127.0.0.1:8876/']
```

It must remain before generic `/avalanche/` static mounts. No Caddy change is needed because `couchdicks.org/avalanche*` already routes to the catalog.

## Monitor

```bash
systemctl --user status avalanche-ecosystem-dashboard.service avalanche-ecosystem-collector.timer
journalctl --user -u avalanche-ecosystem-dashboard.service -n 100
journalctl --user -u avalanche-ecosystem-collector.service -n 100
curl -fsS http://127.0.0.1:8876/api/health | jq
curl -fsS http://127.0.0.1:8876/api/live | jq
curl -fsS http://127.0.0.1:8876/api/radar | jq
npm run healthcheck
```

`/api/health` exposes both `verificationSummary` and `verificationSourceHealth`. Verification sources are optional: a comparator outage can make checks unavailable without marking canonical collector freshness unhealthy.

`/api/live` is intentionally independent from collector freshness. Its C-Chain block sample is cached for 10 seconds, AVAX/TVL/current-day DEX observations are cached for 60 seconds, and the browser polls every 12 seconds only while visible.

## Sites Release Artifact

After committing and pushing the exact source state:

```bash
npm run build:sites
tar -czf .openai/source-archive.tar.gz dist
```

Save the archive against that exact commit SHA and deploy only the returned saved version. Run the normal `npm run build` afterward to restore the Couchdicks-prefixed local artifact.

## Guarded VPS Release

Prepare the release before any service or route change:

```bash
npm run release:prepare
```

This command fails closed unless the approved runtime snapshot has the expected fixed-block quorum, vault counts, 30 complete liquidation days, 145 unique events, and complete protocol coverage. It copies the current runtime, fallback data, service unit, and catalog route source into a timestamped `.release/rollback/` directory, writes and re-verifies a SHA-256 manifest, runs checks and tests, publishes the approved fallback, and builds the candidate bundle. The command does not restart or deploy a service.

Record the printed rollback directory before an explicitly authorized cutover. After that cutover, verify the public route and exact approved lending payload with:

```bash
npm run release:verify-public
```

The public verifier requires HTML, dashboard API, and health HTTP success; a versioned asset bundle; health age no greater than 7,200 seconds; and exact equality between the public and approved local lending fields.

## Recovery

1. Runtime failure: `systemctl --user restart avalanche-ecosystem-dashboard.service`.
2. Stale data: run `systemctl --user start avalanche-ecosystem-collector.service`, then inspect its journal.
3. Corrupt latest snapshot: copy `public/data/dashboard.json` to `state/dashboard.json` and restart the runtime.
4. Changed daily parquet: run the collector normally. The changed fingerprint causes a complete covered-window re-derivation.
5. Remote outage: keep serving the last good snapshot; restore connectivity and rerun the collector.

## Exact Rollback

The pre-change checkpoint is:

```text
/home/openclaw/openclaw-backups/pre-avalanche-ecosystem-dashboard-20260724T1325Z.tgz
SHA256 e802e8041a20208d53f2525fa2beb0862170ab0185a212654e413fb75a3d0286
git tag pre-avalanche-ecosystem-dashboard
git commit b0abf43
```

The immediate pre-route catalog backup is:

```text
/home/openclaw/openclaw-backups/pre-avalanche-ecosystem-route-20260724T135706Z/server.mjs
SHA256 15fc743e9c982a2b0b699bb0a4050f128e700895efb66dba6936eedd5d1def49
```

Remove only this deployment:

```bash
systemctl --user disable --now avalanche-ecosystem-dashboard.service avalanche-ecosystem-collector.timer
rm -f ~/.config/systemd/user/avalanche-ecosystem-dashboard.service
rm -f ~/.config/systemd/user/avalanche-ecosystem-collector.service
rm -f ~/.config/systemd/user/avalanche-ecosystem-collector.timer
systemctl --user daemon-reload
```

Then restore the catalog file from the immediately pre-route backup recorded during deployment, or remove only:

```text
['/avalanche/ecosystem/', 'http://127.0.0.1:8876/']
```

Restart `couchdicks-catalog.service` and verify `/avalanche/`, `avax-aggregators.couchdicks.org`, and all pre-existing health checks. The project directory can then be archived or removed independently.

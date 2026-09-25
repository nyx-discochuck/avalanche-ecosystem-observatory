# Indexing and Scheduled Jobs

## Checkpoints

- `state/blockspace-checkpoint.json`: selected daily parquet names, sizes, and modification times
- `state/tokenized-checkpoint.json`: verified token log partition fingerprint
- `state/lending-metrics.json`: current fixed-block vault inventory and rolling liquidation evidence
- `state/checkpoint.json`: last aggregate refresh, C-Chain tip, latest complete date, and source health
- `state/holder-history.json`: append-only daily holder observations

Collectors use an exclusive lock file, bounded fetch timeouts, retry with exponential delay, and atomic JSON replacement. A matching blockspace or token partition fingerprint skips its full DuckDB work. Lending performs a bounded query over only the latest 30 complete event partitions, while Euler factory/UtilsLens calls and Silo registry/factory/SiloLens calls are pinned to one two-confirmation block selected from an Avalanche RPC quorum. Current Silo factory IDs are discovered every run; legacy config additions arrive through a reviewed pinned-registry update.

Runtime collectors write only ignored `state/*.json` files. `npm run snapshot:publish` is an explicit release operation that copies validated runtime snapshots into tracked `public/data`; scheduled refreshes therefore leave the source worktree clean.

## Schedule

`avalanche-ecosystem-collector.timer` runs hourly at minute 08 with randomized delay. The aggregate and RPC sources refresh each run; parquet derivations run only when their complete daily inputs change. `Persistent=true` catches up after downtime.

Inspect schedules and logs:

```bash
systemctl --user list-timers avalanche-ecosystem-collector.timer
journalctl --user -u avalanche-ecosystem-collector.service -n 100
npm run healthcheck
```

## Reorg Handling

Only complete UTC-day archive partitions are promoted into blockspace and liquidation history. Current vault state is read two blocks behind the lowest healthy RPC tip. If an archive publisher replaces a daily partition after reconciliation, the bounded daily derivation is refreshed before the next atomic publication.

## Rate Limits and Recovery

Remote requests use timeouts and retries. A failed source is recorded in `quality.sourceHealth`; the last good snapshot remains served. Resume by restoring connectivity and starting the oneshot collector. No checkpoint deletion is required.

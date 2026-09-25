# Public release checklist

This file records the requirements and verification state for the isolated public export. It does not describe or authorize changes to any production checkout or service.

- [x] Export is isolated from the production working tree.
- [x] Source, configuration, documentation, tests, and committed snapshots were inspected for credential patterns, private data, host-specific paths, and internal deployment/rollback artifacts.
- [x] Host paths and internal release automation were removed; deployment files use explicit placeholders.
- [x] MIT license, public README, contribution guidance, security policy, environment defaults, and CI are present.
- [x] Runtime falls back from ignored `state/dashboard.json` to committed `public/data/dashboard.json`.
- [x] README documents the optional separately operated Avalanche Gateway and snapshot-only operation.
- [ ] `npm run check`, `npm test`, and `npm run build` pass from a guarded clean install. On 2026-09-25, `npm run check` passed (17 protocols, 21 contracts, and 36 metrics). `npm ci --ignore-scripts --no-audit --no-fund` was blocked by the execution environment with `fetch failed`; the empty npm cache provides no offline fallback. Consequently, `npm test` and `npm run build` both stop at `vite: not found`.
- [x] Independent Git repository has `main` as its default local branch and a clean committed tree (`b10716c7d6fa258e6fb65319fdc14883160307fb` before this evidence-only update).
- [ ] GitHub repository `avalanche-ecosystem-observatory` exists under the authenticated account, is public, and contains the local `main` HEAD. Repository creation succeeded, but Git smart-HTTP rejected the push at the network tunnel with HTTP 403. An SSH fallback reached GitHub but no authorized public key is available (`Permission denied (publickey)`), so the remote remains empty.
- [ ] Anonymous GitHub API/HTTP verification confirms public visibility and expected files. The API confirms `visibility: public` and `default_branch: main`, but reports size `0`; the contents endpoint returns `404` with `This repository is empty.`

Open blockers must remain checked off only when command evidence exists. The authorized HTTPS and SSH push attempts above exhausted the transports available in this execution environment. Current publication attempts and environmental blockers are recorded here and in workflow evidence.

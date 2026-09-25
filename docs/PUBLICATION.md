# Public release checklist

This file records the requirements and verification state for the isolated public export. It does not describe or authorize changes to any production checkout or service.

- [x] Export is isolated from the production working tree.
- [x] Source, configuration, documentation, tests, and committed snapshots were inspected for credential patterns, private data, host-specific paths, and internal deployment/rollback artifacts.
- [x] Host paths and internal release automation were removed; deployment files use explicit placeholders.
- [x] MIT license, public README, contribution guidance, security policy, environment defaults, and CI are present.
- [x] Runtime falls back from ignored `state/dashboard.json` to committed `public/data/dashboard.json`.
- [x] README documents the optional separately operated Avalanche Gateway and snapshot-only operation.
- [ ] `npm run check`, `npm test`, and `npm run build` pass from a guarded clean install. `npm run check` passes; guarded dependency installation is currently blocked by the execution environment's failed package fetch, so tests/build cannot yet load DuckDB/Vite.
- [ ] Independent Git repository has `main` as its default local branch and a clean committed tree.
- [ ] GitHub repository `avalanche-ecosystem-observatory` exists under the authenticated account, is public, and contains the local `main` HEAD. GitHub API access is currently blocked by the environment's CONNECT tunnel (HTTP 403), before authentication can be verified.
- [ ] Anonymous GitHub API/HTTP verification confirms public visibility and expected files.

Open blockers must remain checked off only when command evidence exists. Current publication attempts and any environmental blocker are recorded in the final commit history and workflow evidence.

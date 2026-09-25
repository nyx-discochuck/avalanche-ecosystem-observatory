# Release verification

This repository is an isolated public export of the Avalanche Ecosystem Observatory. Publishing it does not modify or deploy the production dashboard.

## Included

- Application source, collectors, configuration, documentation, tests, and committed fallback snapshots
- MIT license, contribution guidance, security policy, and portable environment defaults
- CI on Node.js 22 using the guarded install, configuration checks, tests, and production build
- Sanitized deployment examples with explicit placeholders instead of private host paths

## Verified before publication

- Credential and private-path scan: no recognized secrets or private production paths
- Configuration validation: 17 protocols, 21 contracts, and 36 metrics
- Test suite: 95 tests passed
- Production build: passed
- Committed snapshot JSON: parsed successfully
- Offline behavior: the UI can load the committed snapshots when optional Gateway endpoints are unavailable

Advanced lending and tokenized-asset refreshes can use a separately operated Avalanche Gateway. See the README and architecture documentation for the supported fallback behavior and data boundaries.

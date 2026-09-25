# Validation and Reconciliation

Validation performed on 2026-07-24 UTC against snapshot schema `couchdicks.avalanche-ecosystem-dashboard.v1`.

## Automated

- JSON schema invariants: 13 protocols, 9 unique verified contracts, 30 metric definitions
- Blockspace formulas recomputed for every covered day
- Lending identity checked per protocol: supplied = borrowed + available
- Stablecoin and tokenized-asset classifications checked for BUIDL overlap
- Null preservation checked for unsupported issuance, revenue, bridge flow, and pair-volume metrics
- Production API deep links, security headers, method denial, health, and catalog endpoints tested
- Six sections navigated in a real Chromium browser with no page or console errors
- Search, methodology dialog, custom dates, chart modes, tables, and deep links exercised
- PNG/CSV chart export, per-chart timeframe lock, and methodology coverage for every KPI/chart exercised
- Desktop 1440×1000 and mobile 390×844 screenshots checked; body width matched viewport at both sizes
- Verification ledger IDs, source links, scopes, tolerances, null handling, and summary counts checked
- RWA.xyz exact-address page parsing tested independently of the live pages
- Avalanche Metrics API transaction, gas-price, and fee-burn parity checked for the latest complete UTC day

Run:

```bash
npm run check
npm test
npm run build
npm run healthcheck
```

## Representative Reconciliation

| Metric | Derived/current result | Independent or raw check | Finding |
| --- | ---: | --- | --- |
| Protocol TVL | `$419.79M` | DeFiLlama current chain endpoint `$419.83M` | `0.009%` same-provider consistency variance |
| Stablecoin cap | `$995.16M` | DeFiLlama per-asset circulating USD sum | Reconciled after excluding BUIDL |
| Verified tokenized value | `$772.77M` | RWA.xyz exact BUIDL/VBILL/ACRED contract sum `$772.70M` | `0.009%` qualified variance; SECZ remains null |
| Broader RWA adapter TVL | `$1.245B` | Named Avalanche RWA protocol adapters | Non-additive and distinct from exact contracts |
| Latest complete DEX day | `$31.908M` | DeFiLlama top-level completed UTC bucket | Kept separate from `$28.152M` current partial-day architecture |
| AMM liquidity proxy | `$73.82M` | Material protocols categorized `Dexs` | Pool-level balances not asserted |
| Lending supplied | `$520.13M` | Aave, BENQI, Euler V2, Silo V2 protocol adapters | Reconstructed from net TVL + borrowed |
| Lending borrowed | `$206.91M` | Same four protocol adapters | Missing protocols not inferred |
| 2026-07-23 transactions | `2,253,251` | Distinct transaction hashes in daily parquet | Formula test passes |
| 2026-07-23 failure rate | `4.6903%` | `105,684 / 2,253,251` | Formula test passes |
| 2026-07-23 fee burn | `225.6351 AVAX` | Sum gas used × effective gas price | Positive per-transaction derivation |
| Verification summary | `13/13` scored checks passed | 2 scope-only; 1 unavailable SECZ value | No material variance |

Figures are collection-time observations and will change on refresh. Material discrepancies are disclosed instead of forcing agreement.

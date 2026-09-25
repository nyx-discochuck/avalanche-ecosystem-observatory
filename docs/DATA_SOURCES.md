# Data Sources and Registry

The authoritative machine-readable inventory is `config/sources.json`; protocol and contract ownership is in `config/protocol-registry.json`.

## Euler V2 and Silo V2 native lending rates

Euler markets are enumerated from the official Avalanche EVault factory and read at one confirmed block through a multi-endpoint public-RPC quorum. The official Avalanche `UtilsLens.getAPYs(vault)` returns borrow APY followed by supply APY, each ray-scaled (`1e27 = 100%`). The display divides each value by `1e25` to produce percent APY. This deliberately uses the lens result: its supply formula applies utilization and the interest fee to the compounded borrow APY, rather than compounding a derived supplier per-second rate. Inactive and zero-IRM escrow vaults are covered by the probe but excluded from the market-rate table.

Silo markets are the deduplicated union of a commit-pinned official Avalanche deployment registry and current `SiloFactory.idToSiloConfig()` children starting at ID 3001. Each config resolves through `getSilos()`; newly discovered current-factory sides are revalidated with `isSilo()`. The official Avalanche `SiloLens` supplies deposit APR, borrow APR, deposits, debt, liquidity, and utilization at the same block. Rate values are wad-scaled (`1e18 = 100%`) and are displayed as APR after division by `1e16`; they are not silently converted to APY. Utilization above 100%, debt above deposits, and zero-liquidity debt states remain visible and are flagged as impaired. Every row carries its fixed block, observation time, source, formula, basis, and degraded state; failed or malformed calls remain null rather than falling back to an adapter.

| Source | Role | Confidence | Refresh |
| --- | --- | --- | --- |
| Avalanche public C-Chain RPC | Tip, fees, gas, token state | High | 5 minutes |
| Euler EVK factory + UtilsLens | Native market discovery, balances, APY | High | Hourly |
| Silo deployment registry + factory + SiloLens | Native market discovery, balances, APR | High | Hourly / release-pinned registry |
| AvaCache parquet | Blocks, transactions, logs | High | Daily |
| DeFiLlama TVL | Chain, protocol, RWA, bridge TVL | Medium | Daily |
| DeFiLlama Dimensions | DEX volume and fee reconciliation | Medium | Daily |
| DeFiLlama Stablecoins | Supply and composition | Medium | Daily |
| DeFiLlama Yields | Non-Euler/Silo lending market APY and TVL | Medium | Hourly |
| DeFiLlama Coins | Current vault and historical liquidation token prices | Medium | Hourly / daily |
| CoinGecko | Primary AVAX spot price and market cap | Medium | 5 minutes |
| CoinPaprika | AVAX spot price and market cap fallback | Medium | 5 minutes |
| Routescan | Labels, verified source, holder samples | Medium | On demand |
| RWA.xyz public asset pages | Exact-address RWA supply and value verification | Medium | Daily |
| Avalanche Metrics API | Transactions, gas price, and fee-burn verification | High | Several times per hour |
| Avalanche Builder Hub | Fee mechanics | High | Release driven |

Core on-chain observations are derived from blocks, transactions, logs, RPC calls, and verified token state. DeFiLlama is an independent aggregate and coverage cross-check, not the sole evidence for blockspace, fee burn, or token supply.

The registry includes official Aave V3/V4, BENQI, Euler V2, and Silo V2 lending roots, material Avalanche DEX architecture classifications, and four issuer-verified RWA token contracts. Child contracts are discovered from official factory or Comptroller state where the registry is designed to grow. Empty DEX contract arrays are intentional: volume currently comes from named adapters, while pool-level event indexing is withheld until factory coverage and deployment blocks are contract complete. Those rows carry a source, confidence, architecture, and limitation instead of guessed addresses.

## Inclusion Rules

- Avalanche C-Chain (`chainId 43114`) only.
- Direct DEX protocol adapters; known aggregator adapters are excluded.
- RWA assets require issuer/deployment evidence and a defensible backing classification.
- BUIDL and other tokenized funds are excluded from ordinary stablecoin market cap.
- Lending supplied value is `Avalanche net protocol TVL + Avalanche-borrowed value`; global protocol totals and other-chain values are never used as fallbacks.
- Bridge TVL is reported by protocol; flows are not asserted without complete event coverage.
- Comparator sources never overwrite canonical metrics. RWA.xyz checks require the exact Avalanche C-Chain contract address; Avalanche Metrics API checks are scored only where definitions match.

## Pricing

Observation-date USD values supplied by protocol adapters are retained for historical TVL, volume, supply, and borrowing. Current vault balances use current DefiLlama Coins prices; liquidation debt uses an end-of-UTC-day historical token price. That is a daily approximation rather than an exact-block execution price. Current AVAX price is used only for current status and clearly labeled current-price fee conversions. Assets without NAV or a defensible market price remain `null`.

RWA.xyz public pages expose source-date, exact-contract supply, and value evidence without requiring client-side credentials. The collector treats this HTML-derived evidence as optional verification: parser or upstream failure marks a check unavailable and leaves the source-of-record value untouched.

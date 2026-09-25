# Methodology

`config/metric-catalog.json` is the authoritative metric catalog consumed directly by the frontend methodology dialogs. Every entry contains definition, formula, unit, source IDs, update cadence, coverage start, limitation, and confidence.

## Global Rules

- Headline KPIs show the latest complete observation. Global 7D, 14D, 30D, All, and custom dates affect time-series charts, not the observation date.
- Current UTC-day blockspace is partial and excluded from period comparisons.
- `null` means unavailable; it is never silently converted to zero.
- Observation-date prices are required for historical USD values. Current prices are never backfilled without an explicit label.
- Native and bridged representations are classified once and protocol-internal movements are excluded where source adapters identify them.

## Avalanche-Specific Economics

C-Chain fee burn is `sum(gas_used * effective_gas_price)`. Avalanche burns both base and priority transaction fee portions. C-Chain fees are therefore not presented as validator revenue.

The live Primary Network supply ledger uses Avalanche's official Data API. Current total supply reconciles as the 360M AVAX genesis unlock plus cumulative staking rewards minted, less cumulative P-, C-, and X-Chain transaction fees burned. Net supply since genesis is current total supply minus the genesis unlock. Total staked and locked AVAX are displayed as current official observations, not historical series.

Validator operating cost, gross profit, and margin still have no defensible direct equivalent and are not inferred.

## Blockspace

- Active transaction senders are distinct top-level `transaction.from` addresses, not inferred people. Avalanche Metrics API `activeSenders` is broader because it also counts transfer-log senders, so the two values are context-only.
- Failures are outer transactions with failed receipt status.
- Top-level contract creations are transactions without a destination; Avalanche Metrics API includes internal `CREATE`, `CREATE2`, and `CREATE3`, so the broader official count is context-only.
- TPS is daily included transactions divided by 86,400 seconds.
- Contract blockspace ranks destination addresses by gas consumed and reports transaction count, distinct senders, burned fees, label confidence, and explorer link.

## Trading and Lending

DEX volume is grouped by actual adapter/protocol architecture: constant product, concentrated liquidity, Algebra CL, weighted, stable-swap, and bin-based/DLMM. In the liquidity-source history, all direct Pharaoh adapter rows are combined into one `Pharaoh` series because the legacy, v3, and DLMM adapters represent the same DEX across its migration; the combination is additive and does not alter daily total volume. DeFiLlama's top-level `total24h` is labeled as its latest complete UTC-day bucket. Architecture rows use the current partial UTC day and reconcile only to that same-day chart bucket. Pair categories are withheld until every material factory and token has deterministic classification and multi-hop deduplication.

Lending supplied, borrowed, and available liquidity are normalized per protocol from the exact DeFiLlama `Avalanche` and `Avalanche-borrowed` keys. Global protocol totals and other-chain keys are never fallbacks; a missing Avalanche value remains null. Every protocol, history, market, vault, and liquidation row carries the Avalanche chain name, C-Chain ID `43114`, and an `Avalanche-only` scope marker. Euler supply and borrow rates retain their official UtilsLens APY basis; Silo supply and borrow rates retain their official SiloLens APR basis. The basis is explicit on every native row, incentive APY remains separate, and missing borrowed values are not inferred from pool TVL. Silo utilization is never capped at 100%; economically impaired states remain observable.

Factory vault assets are a separate current-state measure. The collector establishes an Avalanche RPC quorum, selects the lowest observed tip minus two blocks, enumerates the official Euler `eVaultFactory`, and reads `asset`, `totalAssets`, and `totalBorrows` at that one fixed block. Token amounts use on-chain decimals and current DefiLlama Coins prices. The result is explicitly gross and non-additive: permissionless vaults can hold economically nested assets, factory provenance is not risk curation, and unpriced active vaults stay outside the USD numerator. The two official Silo vault-factory children are shown as test-labeled observations and excluded from the headline.

Liquidation counts come from exact ABI event topics in 30 complete AvaCache daily log partitions. Emitters must match official Aave V3/V4 deployments, the current BENQI Comptroller market list, the current Euler factory list, or—for Silo—the official factory predicate. Events are deduplicated by transaction hash plus log index. Repaid debt is decoded in the debt asset, normalized with on-chain decimals, and valued at the end-of-UTC-day DefiLlama Coins price. A missing price leaves USD value null; it never changes the exact event count.

## Verification Policy

- `exact` and `qualified` comparisons are scored against an explicit percent tolerance.
- `context` comparisons display both values but never pass or fail because their scopes differ.
- `unavailable` means either side is null or the comparator could not be fetched; missing evidence is never converted to zero.
- The summary status is `matched` only for the checks actually scored. It is not a broad dashboard-health label, and optional comparator outages remain visible in the unavailable count.
- RWA.xyz checks bind to exact Avalanche C-Chain contract addresses. BUIDL, VBILL, and ACRED values are compared with a 0.5% tolerance; token supply uses 0.05%.
- Avalanche Metrics API transaction count, average gas price, and fee burn are exact-day primary checks with rounding-only tolerances.
- DeFiLlama chain-TVL parity is labeled a same-provider consistency check, not independent verification.
- CoinGecko/CoinPaprika price parity is timing-qualified and unavailable when both sources are not present in the same collection cycle.

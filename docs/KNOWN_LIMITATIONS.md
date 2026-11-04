# Known Limitations

- Local raw blockspace coverage starts 2026-06-24. Older chain-level TVL and volume are available from independent adapters, but older blockspace is not presented as complete.
- Historical fee USD is not promoted as historical-price adjusted; current-price conversions are labeled.
- The official AVAX supply ledger is a current cumulative observation. Historical daily issuance, reward, burn, stake, and locked-supply series are not inferred from the current totals.
- Pair-level DEX categories are unavailable until material factory, pool, token, and route coverage can remove multi-hop and aggregator duplication.
- DEX liquidity is a protocol TVL proxy where complete pool balances are unavailable.
- Bridge inflow, outflow, and net flow are withheld because the available bridge API requires paid access and no contract-complete local bridge event registry exists.
- Internal contract creations and internal-call failures require traces and are not counted. The broader official Avalanche deployment count appears only as context.
- Routescan holder counts are current observations. Holder history begins when this deployment first records each asset.
- SECZ supply and holders are shown. RWA.xyz currently provides independent value evidence, but the canonical value remains null until the dashboard explicitly adopts and documents that NAV methodology.
- Factory vault assets cover the official Euler V2 factory at one fixed block and are gross/non-additive, not risk-curated net TVL. Active vaults without DefiLlama Coins prices are disclosed but omitted from the USD total. The only official Silo vault-factory children are test-labeled and excluded from the headline.
- Euler rate coverage is factory-complete but the visible table is intentionally limited to active borrow-enabled vaults; factory membership is not an endorsement. Silo rate coverage combines a commit-pinned official registry with current-factory discovery. The registry can contain legacy, expired, dust, or impaired markets, and legacy additions require a registry refresh. Protocol-native token balances and rates remain available when long-tail USD pricing is null.
- Liquidations cover exact Aave V3/V4, BENQI, Euler V2, and factory-validated Silo V2 event lanes for a rolling 30 complete days. Historical USD uses an end-of-day price rather than the exact execution block. Aave V4 reserve-ID amounts remain unvalued if events occur, and protocol deployments outside the registered five-family scope are not claimed.
- Morpho Blue has no verified active Avalanche C-Chain deployment in the current source set and is not presented as deployed.
- DEX factory/router addresses remain incomplete in the contract registry. Architecture and adapter-derived metrics are displayed at medium confidence; event-level pair claims are withheld.
- RWA.xyz public-page markup is not a stable API contract. Exact-address parser failures fail open to an unavailable verification row and never mutate canonical metrics.
- The live throughput, block time, gas utilization, and transaction count are operational pulse metrics from the latest 12 blocks. They are not substitutes for complete-day indexed blockspace statistics.
- Live DeFiLlama DEX volume is the current partial UTC-day adapter total, not a rolling 24-hour value. It remains visually and semantically separate from the latest completed UTC-day headline.
# Tokenized assets

- The verified native-issuance set is curated and contract-specific; it is not a claim of complete Avalanche RWA coverage.
- Ordinary stablecoins, bridged wrappers, DeFiLlama RWA adapter TVL, and RWA.xyz comparator observations are separate scopes and must not be added to verified native issuance.
- A contract value is reported only where an exact mapped product adapter supplies a defensible value. SECZ value remains unavailable.
- Holder counts depend on explorer indexing. Failed reads retain the last-good value with its original observation timestamp and a stale state; missing coverage is never displayed as zero.
- Mint/burn history covers the bounded local event archive. Amounts require verified token decimals, and historical USD mint/burn value is withheld without observation-date NAV.


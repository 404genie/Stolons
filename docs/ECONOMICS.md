# Stolons production economics

Prepared 2026-10-11. These settings are candidates for initialization, not evidence of a mainnet deployment.

## Settings

| Setting | Value | Status |
|---|---|---|
| Curve platform fee | 1,000 millionths = 0.10% | Preserved earlier agreement |
| Curve creator fee | 1,000 millionths = 0.10% | Preserved earlier agreement |
| Expected Raydium curve protocol fee | 2,500 millionths = 0.25% | Must match live GlobalConfig |
| Expected combined curve fee | 0.45% | Excludes network fees and price impact |
| CPMM trading fee | 2,500 millionths = 0.25% | Current API index 0; recheck on-chain |
| CPMM creator stream | 500 millionths = 0.05% | Current API index 0; recheck on-chain |
| Intended split of collected CPMM creator stream | 50% launcher / 50% Stolons | Not implemented; release blocker |
| Graduation fundraising | 85 SOL | Recommendation; live Curve.checkParam must pass |
| Child proposal fee | 0.001 SOL | Recommendation; nonrefundable proposal charge |
| Proposal, voting, selected-child launch | 24 hours each | Recommendation |
| Selected-child migration deadline | 7 days | Recommendation |
| Supply | 1B tokens, six decimals | Existing protocol |
| Curve sale / migration liquidity / reproduction reserve | 800M / 50M / 150M | 85% market / 15% reserve |
| Successful child settlement | Burn 10M parent reserve tokens | Existing protocol |
| Migration LP | 100% burned | Existing on-chain requirement |

85 SOL is quote fundraising, not market cap, and excludes separately charged trading fees. Migration expenses reduce the SOL that reaches the new pool. The live Raydium config governs migration fees, minimum fundraising and allocation limits. Do not promise exactly 85 SOL of usable post-migration liquidity.

## Revenue gap that must be resolved

With the current code, curve creator fees accrue to the launcher, curve platform fees accrue to treasury, and CPMM creator fees accrue entirely to the recorded CPMM creator. The default platform override preserves the launcher as that creator. Burning all LP leaves Stolons with no Fee Key. The earlier proposed 0.025% creator / 0.025% Stolons post-graduation model is therefore a desired policy, not deployed behavior.

Implement a per-token distributor PDA as the recorded CPMM creator, with immutable destinations taken from the registered token creator and treasury. It needs a reviewed collection path and permissionless payout, support for both pool mints, separate accounting for collections and distributions, and rejection tests for substituted pools/destinations, double payout, rounding and Raydium protocol sharing. The existing initializer/launch/registration/preflight must bind this beneficiary; setting a single global platform override to the treasury alone is not a split.

Split net collected tokens equally after any Raydium collection-time protocol deduction. With a zero protocol deduction, nominal 0.05% accrual corresponds to 0.025% per beneficiary. A nonzero deduction reduces both payouts; those nominal percentages cannot be guaranteed. There is no additional Stolons trade fee on top of the CPMM stream in this proposed model. Base-token revenue remains base tokens until independently swapped; it is not automatically SOL revenue.

## Public deployment settings

`production/manifest.example.json` contains the candidate numeric settings and the API's index-zero CPMM address. Deployment program, authorities, treasury, keeper, platform and lookup table are deliberately unset. Do not generate or publish signing keys in this file. Use a distinct mainnet program identity and a separate funded keeper payer.

Prepare frontend settings only after those identities are chosen. `prepare-environment.mjs` keeps transactions disabled. Install a dedicated HTTPS browser RPC scoped by origin, a server RPC, public durable Blob storage, and the keeper secret as separate deployment settings. Run the read-only mainnet preflight; it verifies fee rates and the full 80/5/15 allocation with the live curve limits. Its report explicitly marks shared post-graduation revenue as unimplemented and public launch as unapproved.

## Sources checked

- Raydium API, current CPMM configs: https://api-v3.raydium.io/main/cpmm-config (index 0: D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2, 2500 trade / 500 creator, API checked 2026-10-11).
- Raydium creator ownership and LP rights: https://github.com/raydium-io/raydium-docs-v1/blob/main/products/launchlab/creator-fees.mdx
- Raydium creator protocol share and collection: https://github.com/raydium-io/raydium-docs-v1/blob/main/products/cpmm/fees.mdx

Rates are mutable and API output does not prove deployed account state. The pinned SDK lacks named decoding for the newer creator-fee-share field; fee collection needs current IDL/layout validation before implementation.

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
| Intended split of collected CPMM creator stream | 50% launcher / 50% Stolons | Source implemented; Rust build and live verification pending |
| Graduation fundraising | 85 SOL | Recommendation; live Curve.checkParam must pass |
| Child proposal fee | 0.001 SOL | Recommendation; nonrefundable proposal charge |
| Proposal, voting, selected-child launch | 24 hours each | Recommendation |
| Selected-child migration deadline | 7 days | Recommendation |
| Supply | 1B tokens, six decimals | Existing protocol |
| Curve sale / migration liquidity / reproduction reserve | 700M / 150M / 150M | 85% market / 15% reserve |
| Successful child settlement | Burn 10M parent reserve tokens | Existing protocol |
| Migration LP | 100% burned | Existing on-chain requirement |

85 SOL is quote fundraising, not market cap, and excludes separately charged trading fees. Migration expenses reduce the SOL that reaches the new pool. The live Raydium config governs migration fees, minimum fundraising and allocation limits. Do not promise exactly 85 SOL of usable post-migration liquidity.

## Revenue implementation and verification gate

Fee-sharing version 2 records a per-token PDA (`["fee_authority", mint]`) as the Raydium creator, while lineage retains the user's wallet as the original creator. A signed `enable_fee_sharing` action changes a fresh config from version 1 to version 3 for future launches. Older tokens retain their original Raydium creator and are rejected by the new claim builders rather than having their fees redirected.

The curve claim signs as the PDA, claims to its canonical quote ATA, and forwards only the fresh balance increase to the original creator. Existing CPMM receipts in that ATA remain untouched. The treasury-only SDK claim sweeps the aggregated platform curve vault into treasury's canonical quote ATA; the treasury signs, not the keeper.

The CPMM collection signs as the same per-token PDA and carries the current CreatorFeeShare account. Only after Raydium deducts any collection-time protocol share does the program split the received tokens 50/50 to canonical original-creator and treasury ATAs. Per-token, per-mint cumulative u128 totals prevent repeated one-atom collection from biasing the split; the creator receives at most one atom more than treasury cumulatively. Donations to those fee ATAs are distributed by the same rule. Nothing automatically swaps token-denominated revenue into SOL; wrapped SOL arrives as wrapped SOL.

Direct permissionless Raydium collection deposits into the same token's dedicated PDA ATAs. A later distributor invocation picks up those balances. This avoids mixing different projects' SOL revenue under a global authority. Repeated collection with empty counters and balances sends no payout. If an instruction fails, collection, distribution and accounting roll back together.

Code and SDK fixtures are not proof of deployed behavior. Rust/SBF compilation, fresh v2 launches, treasury and creator claim tests, direct-Ray­dium-collection recovery, substituted accounts, repeated claims, pause, rounding, and restart tests remain required. Existing devnet configuration stays version 1 until an explicit enable action after the program upgrade. New accounts are additive; existing lineage/config layouts are unchanged.

## Public deployment settings

`production/manifest.example.json` contains the candidate numeric settings and the API's index-zero CPMM address. Deployment program, authorities, treasury, keeper, platform and lookup table are deliberately unset. Do not generate or publish signing keys in this file. Use a distinct mainnet program identity and a separate funded keeper payer.

Prepare frontend settings only after those identities are chosen. `prepare-environment.mjs` keeps transactions disabled. Install a dedicated HTTPS browser RPC scoped by origin, a server RPC, public durable Blob storage, and the keeper secret as separate deployment settings. Run the read-only mainnet preflight; it verifies fee rates and the full 70/15/15 allocation with the live curve limits. Its report requires config version 3 and reports that shared-fee source exists but requires live verification; public launch remains unapproved.

## Sources checked

- Raydium API, current CPMM configs: https://api-v3.raydium.io/main/cpmm-config (index 0: D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2, 2500 trade / 500 creator, API checked 2026-10-11).
- Raydium creator ownership and LP rights: https://github.com/raydium-io/raydium-docs-v1/blob/main/products/launchlab/creator-fees.mdx
- Raydium creator protocol share and collection: https://github.com/raydium-io/raydium-docs-v1/blob/main/products/cpmm/fees.mdx

Rates are mutable and API output does not prove deployed account state. The pinned SDK lacks named decoding for the newer creator-fee-share field. Collection passes its mandatory PDA explicitly and delegates protocol-share settlement to Raydium; the source ABI was checked against the current primary Raydium repository, but deployed ABI verification remains required.

Audited governance profile: 0.1% snapshotted winning-support quorum, a 0.05 SOL proposer bond in addition to the proposal fee, and a capped late-leader-change extension. Losing proposals and successfully settled winners receive refunds; expired or orphaned winners forfeit the bond to treasury. See MAINNET.md.

# Stolons architecture

Stolons is a Solana hereditary-token protocol. Raydium LaunchLab creates and trades each token on its bonding curve, then migrates it into Raydium CPMM. Stolons stores family state, voting state, and reproduction reserves. It never prices, swaps, mints, or decides whether a market is healthy.

## Components

- `programs/stolons`: Anchor program. All economically meaningful state changes are enforced here.
- `sdk`: PDA derivation, strict raw instruction serialization, LaunchLab transaction proof helpers, and checked integer math.
- `apps/web`: devnet-first Next.js dashboard. It reads mint/lineage state and currently opens an epoch. Launch construction, proposal/vote forms, and candidate settlement UI are not wired yet; use the typed SDK builders for those instructions while developing.
- `services/indexer`: optional permissionless event indexer. Its Postgres tables are projections only; program authorization never reads them.
- `docs`: protocol invariants, Raydium layout pin, and pre-devnet review.

## Lifecycle

1. A user creates the token with the Stolons LaunchLab platform and global config.
2. The same transaction that contains Raydium `InitializeV2` invokes `register_root_launch` or `register_candidate_launch`. Stolons proves the initializer appeared earlier in the transaction, then checks the pool state, mint, quote mint, creator, fixed supply, platform, and reserve parameters.
3. Raydium graduation creates a CPMM pool. A permissionless recorder checks the Raydium LaunchLab pool and canonical CPMM pool, then marks the token qualified.
4. The reproduction authority PDA claims the platform vesting record after graduation and sends the exact 150M-token claim to a mint-scoped reproduction vault.
5. A parent opens a proposal and voting epoch. Proposals reserve a child mint; votes transfer parent tokens into a per-epoch escrow. Each wallet has one receipt per epoch.
6. Once voting ends, the highest supported proposal wins; ties go to the lower proposal ID. Holders can withdraw escrow after finalization.
7. The selected child must launch before its launch deadline and graduate before its migration deadline. An unsuccessful attempt is permanently orphaned and does not burn parent supply.
8. `finalize_child` burns exactly 10M parent tokens from the parent reproduction vault and transfers an equal root-mass amount from the parent lineage to the child lineage. It does no Raydium CPI.

## Initial settings

- Standard SPL Token, six decimals, fixed 1B supply, no mint or freeze authority.
- 850M token atoms are available to the LaunchLab market path; 150M are locked outside curve and graduation liquidity for reproduction.
- LaunchLab uses CPMM migration, the Stolons platform config, and an immediate-at-graduation vesting schedule for the reserve.
- Platform migration LP scales are pinned to platform 0%, creator 0%, burn 100%.
- Stolons and creators receive no token allocation.

## Program authority

`initialize_config` is one-time and sets all external program/config addresses, fee recipient, and phase windows. `set_paused` can only pause or resume new root registrations, epoch openings, and selected candidate launches. It cannot alter family state, vault balances, or token supply. The upgrade authority remains an operational trust point until it is transferred to a reviewed multisig or the program is made immutable.

The declared program ID in this checkout is a development placeholder. Generate the deploy keypair, run `anchor keys sync`, and update app/indexer environment variables before a local validator or devnet deployment.

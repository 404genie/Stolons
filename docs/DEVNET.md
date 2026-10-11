# Devnet acceptance runbook

Do not deploy to mainnet as part of this runbook. Use a fresh keypair and a persistent devnet program/configuration so each transition can be inspected after the next step.

## Codespaces quick start

Create a Codespace for this branch. The devcontainer installs Node 24, Rust 1.89.0, Solana 2.3.0, Anchor 0.32.2, and pnpm 11.25.0. Wait for the post-create command to finish; if it fails, rerun `bash .devcontainer/setup.sh` and inspect its output.

Run each command separately, stopping on any error:

```bash
bash scripts/devnet/prepare.sh
bash scripts/devnet/fund.sh
bash scripts/devnet/build.sh
bash scripts/devnet/deploy.sh
```

`prepare.sh` generates fresh Devnet-only wallet/program keys in ignored `keypairs/`, synchronizes the program ID, and updates local app/indexer env files. It preserves existing keys. These private keys stay in the Codespace; keep a private backup before deleting the Codespace if you want to retain the deployment identity. Never commit them or use a mainnet wallet.

`fund.sh` requests 2 test SOL. The faucet may rate-limit requests; use https://faucet.solana.com with the printed public wallet address if needed. Deployment needs enough balance for the program rent and transaction fees. If the CLI reports insufficient funds, request more test SOL and rerun deployment with the same keys.

`build.sh` runs host Rust tests, SBF/stack checks, IDL parity, SDK/client tests, and all package builds. `deploy.sh` fixes its RPC to Devnet and verifies the recorded binary/IDL hashes and program identity. Deployment is performed only when you explicitly run that command.

After deployment, record the printed program ID and the contents of `target/devnet/program-show.txt`. Share public addresses or error output only. Next verify the Raydium Devnet programs and platform configuration before initializing Stolons; deploying the binary does not initialize the protocol or launch a token. The optional indexer also needs a PostgreSQL `DATABASE_URL`.

## Before deploying

1. Install Rust 1.89.0, Solana/Agave 2.3.0, and Anchor CLI 0.32.2.
2. Generate a unique deploy keypair; run `anchor keys sync`; copy the resulting program ID to `apps/web/.env.local` and `services/indexer/.env`.
3. Install workspace dependencies and run `pnpm test`, `cargo test --workspace`, `anchor build`, `pnpm idl:sync`, `pnpm idl:check`, `pnpm sdk:build`, `pnpm web:build`, and `pnpm indexer:build`.
4. Ensure the SBF output contains no stack-frame overflow; run `pnpm stack:check -- <build-log>`.
5. On devnet, independently verify LaunchLab program ID, CPMM program ID, LaunchLab global config, quote mint, CPMM config, and platform config. Check platform fee recipient, vesting PDA, 100% platform vesting scale, and migration LP burn scale before initializing Stolons.
6. Initialize Stolons exactly once with devnet windows suitable for testing, the documented fee recipient, and a low but nonzero test proposal fee. Record every account address.

## Root token

1. Generate a fresh mint keypair for the LaunchLab InitializeV2 builder. Let Raydium initialize the standard SPL mint; verify six decimals, exactly 1B supply, and revoked mint/freeze authorities after the atomic launch transaction. Do not pre-create the mint separately.
2. Configure LaunchLab supply=1B, locked reserve=150M, zero cliff/unlock, CPMM migration, and the canonical Stolons platform/config.
3. Compose `InitializeV2` and `register_root_launch` in one transaction. Confirm the on-chain pool records the creator, mint, quote mint, config, platform, supply, and reserve as expected.
4. Graduate the pool through Raydium. Call `register_root_migration` with the canonical CPMM pool. Confirm fake owner, wrong config, wrong mint, and wrong PDA cases fail.
5. Call `claim_root_reproduction_reserve`, verify exactly 150M newly arrived in the vault, then `activate_root`.

## Governance and candidate

1. Open an epoch; confirm a second epoch is rejected and a paused protocol rejects opening another one.
2. Submit two different child mints; confirm the 0.01 SOL fee, limit, duplicate mint reservation, and proposal text limits.
3. Vote from multiple wallets; confirm a second receipt for the same voter fails, token/mint substitution fails, and a tie goes to the earlier proposal ID.
4. Confirm votes cannot withdraw before finalization, then withdraw each escrow once.
5. Finalize the selected child. Confirm non-winners and expired selections cannot launch.
6. Create the Raydium child launch and append `register_candidate_launch` to the exact InitializeV2 transaction. Check candidate creator, supply, locked amount, vesting record, and launch deadline.
7. Test a non-migrating launch through expiry. Confirm it becomes Orphan and the parent can open another epoch without a burn.
8. In a separate run, graduate the child before its deadline; verify both LaunchLab Trade state and CPMM PDA/config/mint pair. Call migration registration after the cutoff to prove a timely graduation cannot be orphaned because a registrar was late.
9. Claim the child's 150M reserve, then call `finalize_child`.
10. Check parent supply fell by exactly 10M, parent reproduction vault fell by exactly 10M, child root mass equals the checked integer formula, and family mass still sums to 1B.
11. Repeat for one generation. Verify the next generation that rounds to zero is rejected at `open_epoch`, with no active epoch left behind.

## Adversarial cases

- Wrong LaunchLab/CPMM owner, discriminator, layout, program ID, platform, quote mint, pool PDA, CPMM config, or mint order.
- Missing InitializeV2 proof or proof for a different pool/mint.
- Mint authority/freeze authority present; Token-2022 mint passed to the standard SPL path.
- Incorrect vesting record beneficiary, claim amount, base vault, or LaunchLab signer.
- Fake parent/child/family/epoch/proposal/candidate/receipt/vault PDA.
- Wrong vote token mint, another voter's destination, duplicate vote, early withdrawal.
- A zero-root-mass parent, insufficient reserve, 16th child, double settlement, expired launch, and migration timestamp beyond deadline.
- Donation to reproduction vault before/after claim; settlement must still work after the exact reserve delta is verified.

Record signatures, account snapshots, IDL hash, binary hash, toolchain versions, and exact config addresses. Only after the entire sequence passes from a clean deploy should a separate mainnet threat review begin.

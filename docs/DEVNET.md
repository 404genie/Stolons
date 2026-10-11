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

### Browser root launch

Run `bash scripts/devnet/web.sh` after pulling updates; it rebuilds the SDK before starting the web app. Open `/launch` and connect a devnet-funded Phantom wallet. Any creator can use the deployed Stolons platform; a creator does not need the protocol authority wallet.

Enter a name, ticker, description, PNG/JPG/WebP image (up to 3 MB), and optional website/X/Telegram links. Users never upload or host a JSON file. **Preview launch** requests a wallet message approving publication of these exact details, then the app saves the image, generates the token JSON, validates it, and simulates the launch. The publication signature is bound to the image hash, normalized fields, wallet, site, and a five-minute timestamp; it does not authorize a chain transaction.

`web.sh` automatically reuses the shared table in `target/devnet/child-launch-table.json`. Set `NEXT_PUBLIC_LAUNCH_LOOKUP_TABLE` explicitly when running outside that Codespace. Versioned transactions compress shared accounts so normal hosted metadata URLs fit without splitting launch and registration.

For `next dev`, uploads are stored in ignored `apps/web/.stolons-uploads/` and served by the app. Keep the Codespace and public HTTPS URL alive for Devnet metadata; these local files are not production storage. On deployment, connect a **public** Vercel Blob store and set the server-only `BLOB_READ_WRITE_TOKEN`. Deployed uploads fail closed without durable storage. Configure platform rate limits for `/api/metadata` before opening production; the route's wallet burst guard is per process, not a distributed quota. Image/JSON paths are content-addressed and are not overwritten. Credentials are never sent to the browser.

The preview shows the image, token details, mint, and estimated test-SOL cost. **Sign and launch** refreshes configuration/blockhash, checks metadata again, and simulates before requesting a wallet signature. Only the devnet genesis hash is supported; oversized transactions are rejected before signing. This browser flow does not submit a first buy or graduate the token.

After submission, inspect the token and transaction links. If submission or confirmation is uncertain, inspect this mint before retrying. A confirmed launch starts in `RootPending`; graduation, reserve claim, and activation remain separate steps. Metadata is validated by the client and remains hosted off-chain; the on-chain program does not bind token JSON content.

### Script root launch

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

### Browser bonding-curve trading

Open a newly launched token's `/token/<mint>` page and connect Phantom on devnet. Choose Buy or Sell, enter an amount, and preview. Quotes include the Raydium protocol, Stolons platform, and creator fees. Network fees and temporary account rent require additional devnet SOL. The preview simulates before showing confirmation, and confirmation refreshes the price while retaining the minimum output you reviewed. Quotes expire after 60 seconds; changed inputs or wallets require a new preview.

Try a small buy, check the transaction on Solana Explorer, then sell part of the received tokens. Amounts use integer token units (nine decimals for SOL, six for these tokens). Slippage accepts 0.01%–10%. Trades use a new temporary wrapped-SOL account and close it in the same transaction; existing wrapped-SOL accounts are not closed. An uncertain submission shows the signed transaction ID and blocks another trade until you acknowledge checking it.

This update supports the Raydium bonding curve on devnet. A completed curve or a registered CPMM pool shows that graduated trading is pending rather than submitting a curve trade. Mainnet remains disabled.

Validation: `pnpm sdk:build && pnpm test:client && pnpm web:build`. The trade regression fixtures are public devnet account snapshots, including a simulated post-buy pool; tests run without network access.

### Frontend workspace

The discovery page reads registered lineages directly from devnet and loads token names, symbols, images, and social links from Metaplex metadata. Filter roots, descendants, or launches by the connected creator wallet; paste a mint address to open a token. Token pages show actual bonding-curve fundraising progress, supply, parent/root links, reserve state, and trading. Launch includes image upload and a live identity preview. Reproduction shows eligibility and supports opening the on-chain round. Proposal, vote, child-launch web actions and graduated CPMM trading remain pending.

Wallets may add compute-budget priority-fee instructions to a trade. The client verifies unchanged payer, blockhash, and all non-budget instructions, caps compute units at 1.4M and price at 1M micro-lamports per unit, then simulates the exact signed transaction with signature verification before submission.

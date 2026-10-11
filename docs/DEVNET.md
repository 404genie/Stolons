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

This update supports the Raydium bonding curve on devnet. Completed curves show Raydium migration status. Migrated pools trade through CPMM. Mainnet remains disabled.

Validation: `pnpm sdk:build && pnpm test:client && pnpm web:build`. The trade regression fixtures are public devnet account snapshots, including a simulated post-buy pool; tests run without network access.

### Frontend workspace

The discovery page reads registered lineages directly from devnet and loads token names, symbols, images, and social links from Metaplex metadata. Filter roots, descendants, or launches by the connected creator wallet; paste a mint address to open a token. Token pages show actual bonding-curve fundraising progress, supply, parent/root links, reserve state, and trading. Launch includes image upload and a live identity preview. Reproduction supports round opening, child proposals with hosted metadata, token-weighted voting, winner selection, vote refunds, selected-child launch, and expired-candidate recovery. Graduation registration, reserve claiming, family activation, and CPMM trading are available.

Wallets may add compute-budget priority-fee instructions to a trade. The client verifies unchanged payer, blockhash, and all non-budget instructions, caps compute units at 1.4M and price at 1M micro-lamports per unit, then simulates the exact signed transaction with signature verification before submission.

### Graduation and CPMM

The token page reads the LaunchLab status: trading, migration pending, or migrated. Raydium performs migration; the frontend polls every 15 seconds while migration is pending. After the migrated pool appears, the Graduation & activation panel provides one transaction at a time to register migration, claim the reserve, and activate a root or finalize a selected child. Each step rereads state, simulates before wallet approval, verifies wallet-returned instructions, and simulates the signed transaction. An uncertain send retains its signature and requires inspection before another action. Confirmed steps resume from on-chain state after reload.

Migrated token trades use the canonical configured CPMM pool. Quotes subtract protocol, fund, and creator fees held in vaults from usable reserves, apply SDK swap calculations with direction-aware creator fees, and enforce the reviewed minimum. Existing wrapped-SOL accounts remain untouched.

Graduated pages show market cap and liquidity in test SOL, and token age from the on-chain creation timestamp. Market cap uses current minted supply (including locked reserve) at spot pool price; liquidity values both reserves at that price. One-hour volume scans confirmed CPMM swaps and quote-vault turnover. Incomplete, excessive, missing, or netted multiple-swap history shows unavailable rather than an invented number. Production volume should move to indexed swap events for high-throughput pools. The market endpoint caches responses for 30 seconds.

### Automatic graduation keeper

`services/keeper/graduation.mjs` scans pending Stolons lineages and resumes pool registration, reproduction reserve claim, and root activation or child finalization. Raydium still performs the liquidity migration. Run it as one continuously running backend service; it does not depend on a browser session. The keeper pays fees and account rent with a dedicated funded server wallet. Protocol authority keys are not needed.

Build the SDK, provide the settings from `services/keeper/.env.example`, then inspect a dry run with `node services/keeper/graduation.mjs --once`. Start automatic submission with `node services/keeper/graduation.mjs --apply`. Each step is signed, simulated, confirmed, and reread before proceeding. Uncertain submission or confirmation halts the worker for operator review. A restart discovers the on-chain remaining step. Run only one instance and monitor logs and payer SOL balance.

For mainnet, explicitly set `KEEPER_CLUSTER=mainnet-beta`, the mainnet RPC, deployed Stolons program ID, and a mainnet lookup table if needed. The SDK verifies the genesis hash and canonical Raydium programs. Mainnet is not deployed or enabled by these changes; provision and test the worker before opening mainnet launches. Users then need no graduation activation approvals. Devnet retains manual controls for testing.

Discover now separates new launches (unmigrated pools) and graduated tokens (migrated CPMM pools), independently of reserve activation. Graduated token pages lead with market statistics, while curve and migration status refresh automatically.

### Market currency and recent transactions

Graduated token statistics display test SOL on devnet. With `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta`, the read-only market API verifies the mainnet genesis hash and canonical Raydium accounts, then converts market cap, liquidity, and one-hour volume to USD using Pyth Hermes SOL/USD. The displayed volume uses the current SOL/USD rate, rather than historical per-trade dollar prices. Quotes older than 120 seconds or with more than 2% relative confidence are rejected; unavailable prices or incomplete history display unavailable values, never invented zeroes. Price data is display-only and does not affect swap execution. Hermes API: https://docs.pyth.network/price-feeds/core/fetch-price-updates . Mainnet RPC and deployed Stolons program ID must also be configured; this does not enable mainnet launch or trading.

Token pages show the 15 most recent confirmed pool transactions from LaunchLab and, after migration, CPMM, refreshed every 15 seconds. The table includes time, venue, execution status, and a cluster-correct explorer link. Pool activity includes swaps and non-trading operations; failures remain visible. Missing history is reported as unavailable.


### One-pass reproduction test

1. Pull the branch, run `pnpm install` and `pnpm sdk:build`, and restart the web app. Use an active root whose reserve is activated.
2. In a second Codespaces terminal, run `bash scripts/devnet/keeper.sh --apply`. This uses the existing devnet wallet keypair as the fee payer. It can activate any eligible Stolons token; it does not need the token creator's private key. Keep its wallet funded and the terminal running. If the worker reports uncertain submission, inspect the printed transaction before restarting.
3. Open the parent token's reproduction page and fill in the child's name, ticker, description and image. The first proposal form can open the round and submit atomically, so the 60-second devnet proposal window does not run while you fill in the form. The separate open-round button is also available for a community round. The proposal fee and account rent are shown before submission. Your wallet separately approves public metadata and a private child-mint recovery message. The recovery signature stays in the browser and is never uploaded. Ed25519 message signing deterministically recovers the same child mint from the proposer wallet after a page reload. Proposals created through older CLI tooling still require the CLI's original mint keypair to launch.
4. When the proposal countdown ends, vote with parent tokens. One wallet casts one vote per round. Highest token support wins; a tie goes to the earlier proposal. After voting ends, finalize the round. An unsupported round closes without a winner.
5. Return escrowed vote tokens using the refund button. The round-history selector allows returning tokens after selection and after a new round opens.
6. Use the proposer wallet to preview and launch the selected child before the launch deadline. Its on-chain name, ticker, URI and metadata hash must match the winning proposal. Initialization and Stolons child registration are atomic. Reloading the page does not lose the child mint key.
7. Open the child token page and buy the remaining curve allocation. Raydium migrates liquidity; the running keeper registers migration, claims the reproduction reserve, and settles the child. Manual activation buttons remain available as a devnet fallback. Refresh the parent: successful children increases by one and its reproduction reserve falls by 10M tokens. The child becomes an active descendant and can reproduce.
8. Run `node scripts/devnet/verify-family.mjs ROOT_MINT CHILD_MINT` to verify the expected child's activation, parent supply/reserve accounting, successful descendant count, revoked token authorities, and conserved family ancestry mass. This command only reads chain state.

Automated checks cover round windows, proposal slot races, one vote per wallet, refunds, no-winner finalization, candidate expiry, atomic child launch, deterministic mint recovery, and keeper restart/uncertain-send handling. Existing settled devnet family accounts and live open-round/proposal simulation also provide chain-level verification. A newly created full frontend flow still needs the final wallet-signed test above before devnet is called complete.

# Mainnet preparation — 2026-10-11

## Verified devnet settlement

Read-only RPC inspection verified the newly tested family:

| Account | Address | Result |
|---|---|---|
| Parent | `AHiWHhZpWwCQCENcsXLrrfywUNnJSqraSAnKnLq3ZcJj` | Active root, one successful child |
| Child | `2LjFu7q9TAjpD15GYV2YYDtsuZYheBJSsL43DrySEZXm` | Active generation-one descendant |
| Parent supply | — | 990,000,000 tokens |
| Parent reserve | — | 140,000,000 tokens |
| Child reserve | — | 150,000,000 tokens |
| Required parent burn | — | 10,000,000 tokens |
| Conserved root ancestry mass | — | 1,000,000,000,000,000 atoms |

Both mint and freeze authorities were revoked. The earlier reference family also passed the same checks. This validates settlement; it does not establish multi-wallet voting, adversarial account handling, or generation-two settlement. Raw results for the new family are in `docs/validation/devnet-family-2026-10-11.json`.

## Preparation included in this branch

- The one-time initializer now requires the current upgrade authority from this program's canonical, loader-owned ProgramData PDA. The SDK initialization account schema and devnet configuration script include that account. A Rust test covers correct, unrelated and absent upgrade authorities. The supplied Codespaces log confirms the patch compiled and the program was upgraded on devnet; existing configuration remains intact.
- `production/manifest.example.json` lists public deployment identities and economics. Missing deployment identities deliberately fail validation. The example now preserves 0.10% platform + 0.10% creator fees; it proposes 85 SOL fundraising and a 0.001 SOL proposal fee. Proposed windows are 24 hours for proposals/votes/selected-child launch and seven days for migration. These are drafts; config durations become immutable after initialization.
- `scripts/production/preflight.mjs` performs local manifest validation or read-only on-chain checks. It never submits transactions or reads private key files. It rejects devnet IDs/RPC, a 1 SOL test graduation target, zero platform/creator revenue, short test windows, and an authority used as the keeper payer.
- CI now includes web tests in addition to unit/client tests, builds, Rust/SBF and IDL gates.

## Release gates still open

1. **Exercise initializer authorization on a fresh deployment.** The supplied Codespaces log confirms nine Rust tests, SBF compilation, IDL synchronization, 13 unit tests, 50 client tests and web/indexer builds, followed by a successful devnet program upgrade. Existing initialized config cannot test initialization by an unrelated signer; add correct-signer and wrong-signer integration cases on a fresh validator/deployment.
2. **Exercise metadata substitution through a custom client.** The child metadata patch is now compiled and deployed on devnet. Candidate registration compares the matched atomic InitializeV2 name, ticker and URI with the winning proposal. Rust and SDK tests reject substitutions, truncated payloads and oversized lengths. A custom-client integration test of the deployed program is still required. The program binds the URL, not fetched JSON bytes: immutable hosting and hash checks remain required.
3. **Verify production clients against the real mainnet deployment.** SDK root/child launch, trading, reproduction, graduation and recovery now accept explicit cluster settings and reject mismatched RPC genesis. Mainnet launch requires an explicit graduation target, and recovery uses a separate mainnet signing domain while preserving existing devnet keys. The frontend requires its own program, RPC, lookup table and target; `NEXT_PUBLIC_ENABLE_MAINNET_TRANSACTIONS` defaults to false. Mainnet activation uses the keeper rather than user wallet buttons. Local fixtures and configuration tests are not mainnet transaction verification. Validate launch, curve/CPMM buy/sell and child settlement with the final deployed accounts before opening access.
4. **Validate Raydium mainnet accounts/layouts.** Mainnet preflight compares canonical SDK program/config IDs, owners, curve type, reviewed protocol/CPMM fee rates, curve allocation/target limits, treasury, full reproduction vesting, LP burn allocation, CPMM creator override and fees. Inspect current accounts and primary Raydium docs before choosing the final configs; current mainnet accounts were not checked without a dedicated RPC/deployment.
5. **Compile and exercise post-graduation revenue sharing.** Preserve the earlier agreement: 0.10% platform + 0.10% creator before graduation. The current API advertises 0.25% CPMM trade + 0.05% creator fees. Version-2 source now uses a per-token creator PDA, forwards curve creator fees, and splits net CPMM creator receipts 50/50. The treasury-only SDK sweep targets the platform vault. Neither Rust/SBF compilation nor live fee sharing has been verified yet. Existing devnet config is unchanged until the explicit enable step. A native creator-fee counter has one beneficiary; keep the global platform override zero so each launch preserves its own PDA. Account for Raydium's collection-time protocol share and integer rounding. Keep LP fully burned. The 85 SOL target and 0.001 SOL proposal fee in the example are recommendations, not deployed policy. See [ECONOMICS.md](ECONOMICS.md).
6. **Deploy production infrastructure.** Dedicated RPC, HTTPS frontend, public durable Blob store, funded separate keeper payer, and optional PostgreSQL indexer. In-process upload burst limits are per instance and per wallet, not a distributed abuse defense; apply deployment-level throttling. Browser RPC credentials are public: scope them by origin and provider limits. The current RPC history volume feed can be incomplete; do not label partial data as complete.
7. **Complete adversarial integration review.** Multi-wallet/tied votes, paused refunds, repeated settlement/claim, expired candidates, migrated-before-deadline recovery, wrong Raydium accounts, donation handling, 15-child cap and generation-two settlement. Arrange independent review of the final program artifact and authority custody. The initializer fix and this internal review are not an external audit.

## Run preparation checks

```sh
pnpm sdk:build
pnpm test
pnpm test:client
pnpm test:web
pnpm typecheck:clients
pnpm web:build
pnpm indexer:build
```

In Codespaces, the pinned Rust/SBF/IDL checks are included in:

```sh
bash scripts/devnet/build.sh
```

For public mainnet configuration, copy and populate the manifest after selecting identities/economics. Never put private keys or RPC tokens in the manifest or Git.

```sh
node scripts/production/preflight.mjs production/manifest.json --offline
# With MAINNET_RPC_URL and server-only BLOB_READ_WRITE_TOKEN in the environment:
node scripts/production/preflight.mjs production/manifest.json
```

Online checks require a deployed/initialized mainnet program and a funded keeper; they are for reviewing that concrete configuration, not authorizing deployment. `graduationTargetLamports` is an approved per-launch client setting, not a value stored in the existing GlobalConfig: preflight validates its range; the launch clients use the same explicit target, but each deployed frontend configuration still needs verification. Blob credential presence does not prove the store is public or healthy; run a signed production upload, fetch its immutable image/JSON URLs, and verify hashes.

## Deployment order after release gates pass

Generate a distinct mainnet program identity; synchronize Anchor/source/SDK identities; build and record artifact/IDL hashes; review treasury, authorities and the final manifest. Deploy the reviewed artifact, initialize as upgrade authority, and verify exact config before opening the frontend. Account authorization must be present before deployment, so another signer cannot race configuration initialization.

Run preflight, then a deliberately small end-to-end mainnet launch/trade/child smoke test with the chosen real graduation target. Deploy the keeper separately with only its funded fee payer, compare its public key to the manifest, and start with `--once` dry-run. Enable `--apply` only after the read-only phase identifies the correct deployment. Monitor submitted transactions, payer balance, failures and restart behavior; uncertain submissions require inspection before restarting.

Only enable public mainnet transaction controls after the complete flow and economic settings are verified. Keep upgrade/config authority custody separate from the keeper, and document recovery/pause ownership.

## Cluster-aware frontend settings

Use the validated manifest to generate public settings without submitting transactions:

```bash
MAINNET_BROWSER_RPC_URL=https://your-origin-scoped-rpc.example node scripts/production/prepare-environment.mjs production/manifest.json target/mainnet-public.env
```

The tool refuses to overwrite an existing file. It writes only public network/program/lookup-table/target settings and sets `NEXT_PUBLIC_ENABLE_MAINNET_TRANSACTIONS=false`. Keep server Blob credentials and keeper signing keys separate. Browser RPC URLs are visible to users; use origin restrictions. Review and install these settings in the frontend deployment, then complete the release gates before explicitly enabling transactions. `production/.env.example` contains the corresponding server and keeper settings. This branch does not deploy or fund mainnet accounts.

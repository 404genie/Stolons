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
5. **Compile and exercise post-graduation revenue sharing.** Preserve the earlier agreement: 0.10% platform + 0.10% creator before graduation. The current API advertises 0.25% CPMM trade + 0.05% creator fees. Version-2 source now uses a per-token creator PDA, forwards curve creator fees, and splits net CPMM creator receipts 50/50. The treasury-only SDK sweep targets the platform vault. Rust/SBF compilation and devnet fee sharing have now passed. Live checks verified protocol CPMM settlement into treasury and creator escrow, creator-only manual claims, curve creator claims, an empty repeat claim, and curve treasury sweeps. The temporary curve fee rates were restored to their original zero values. Production settings still require mainnet preflight and validation. A native creator-fee counter has one beneficiary; keep the global platform override zero so each launch preserves its own PDA. Account for Raydium's collection-time protocol share and integer rounding. Keep LP fully burned. The 85 SOL target and 0.001 SOL proposal fee in the example are recommendations, not deployed policy. See [ECONOMICS.md](ECONOMICS.md).
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

Online checks require a deployed/initialized mainnet program and a funded keeper; they are for reviewing that concrete configuration, not authorizing deployment. `graduationTargetLamports` must equal the immutable 85 SOL mainnet policy. The program reads Raydium PoolState.totalFundRaisingB and enforces that exact amount for root/child registration and lifecycle validation; SDK, frontend and preflight reject lower or higher mainnet targets. The value is a program constant rather than a mutable GlobalConfig field. Blob credential presence does not prove the store is public or healthy; run a signed production upload, fetch its immutable image/JSON URLs, and verify hashes.

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

## Intended treasury

The intended mainnet treasury is `FRVw3s9Wz4pKzRuUwEj9FZYa39vLbAfXzUqiDYAK2K87`, provided by the owner. It is recorded in the production manifest template. Deployment initialization and the Raydium platform fee wallet must use this same address; preflight checks both. This records deployment intent and does not change any existing on-chain configuration. The mainnet program, platform config, authorities, keeper and lookup table still need their deployment-specific addresses.

## Generated mainnet identities and isolated build

The owner generated and backed up these public identities in Codespaces:

| Role | Public address |
|---|---|
| Program | `8uXCB9g8ctvVddm9W992KF862PX1gT5kijEQmbdbjQ8B` |
| Upgrade/config authority | `ABANF7g1F8UfAXEtBWVuFdodJ3QzAS9oTWj9fSoLx2MC` |
| Keeper payer | `HwM5Ufv3yLLEemHeWqKhmctSCXM9K7Qbgp8hENrE84T2` |

These addresses do not establish a deployment. The platform configuration and lookup table remain pending.

```bash
git pull --ff-only
bash scripts/production/build.sh
```

The build verifies local keys against `target/mainnet/manifest.json`, archives committed source into an isolated directory, synchronizes that copy's Rust/Anchor identities, and runs Rust, unit, SBF/IDL and client checks. Uncommitted changes are excluded. It writes `stolons.so`, `stolons.json`, artifact hashes and the source commit to `target/mainnet/` without changing devnet artifacts or sending transactions. Keep the local build directory private: it contains a copy of the program key.

Do not run the complete production preflight yet: it correctly rejects the missing platform and lookup table addresses. Build and review the artifact first, then obtain deployment-specific addresses through deployment and initialization.

The successful Codespaces build and owner-reported hashes are recorded in [validation/mainnet-build-2026-10-11.json](validation/mainnet-build-2026-10-11.json). This records build evidence, not an audit or deployment approval. Before spending SOL, inspect the canonical live venue configurations:

```bash
node scripts/production/inspect-venues.mjs
```

This read-only tool accepts the incomplete local manifest. It checks mainnet genesis, Raydium executable/configuration owners and discriminators, reviewed venue fees, the 85 SOL curve target and allocation, authority/keeper balances, and minimum ProgramData rent. The reported rent excludes temporary buffer funding, executable-account rent, transaction fees and initialization costs. It defaults to public mainnet RPC for this inspection only; a dedicated endpoint can be supplied privately as `MAINNET_RPC_URL`.

Before any further Railway or Vercel deployment, consolidate the completed repository branches into `main`, verify the resulting source tree and provide that single branch ZIP for the owner's audit. Keep private keys and credentials excluded.

Mainnet RPC verification was corrected after the first live venue inspection: the canonical full genesis hash is `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`, as documented at https://solana.com/docs/payments/agentic-payments/x402. SDK, preflight, venue inspection and graduation keeper now share the SDK check. Regression fixtures reject both the former incorrect suffix and the truncated CAIP-2 identifier. Rebuild the SDK after pulling this correction before rerunning inspection. This JavaScript/TypeScript correction does not change Rust program source or the previously recorded program artifact.

## Approved allocation correction

Live mainnet inspection reported `minMigrateRateA=150000`, a 15% migration minimum, and a 24 SOL minimum fundraising target. The owner approved 70% curve / 15% migration / 15% reproduction reserve. The 85 SOL target remains unchanged. New root and child registrations now enforce exactly 700M curve tokens; clients encode that allocation and preflight validates it. Previously registered tokens retain settlement compatibility. The 150M reserve, 10M parent burn and 15-child limit are unchanged.

The earlier `2780cc2` artifact is historical build evidence and is superseded for deployment by this Rust change. Run a fresh isolated mainnet build and record its new hashes. No repeat of the full devnet lifecycle is required for this allocation update; focused local encoding/constraint checks and the new Rust registration test cover the change. No program or hosting deployment has been performed for this change.

The owner supplied a successful revised Codespaces build with 67 client tests and a passing live venue inspection. The new program artifact is 783,368 bytes with SHA-256 `1699960cc365f66d5576f452510fc965ee4a12a19f3ba33979f4dfd9dacd564c`. The live report records zero authority/keeper balances and 3.98038828 SOL of ProgramData rent only; executable-account rent, temporary buffer funding, transaction fees and initialization costs are additional. This evidence is recorded in [validation/mainnet-allocation-2026-10-11.json](validation/mainnet-allocation-2026-10-11.json).

Generate an offline release review containing the source commit, both artifact hashes, and authority-derived platform/config/reproduction addresses:

```bash
node scripts/production/prepare-release.mjs
```

It writes `target/mainnet/release-review.json`, reads no private keys, sends no transactions and leaves the local manifest intact. Derived addresses are planned identities, not proof of initialized accounts. The lookup table and complete initialized configuration remain pending.

## Audit corrections — pending new artifact

The reviewed mainnet policy now enforces 85 SOL on-chain using the pinned PoolState fundraising field at byte 69. Canonical devnet keeps its 1 SOL policy. An on-time positive vesting timestamp protects both status 1 and status 2 candidates against expiry. Raydium documentation currently conflicts about whether this timestamp is stamped at fundraising completion or migration; a narrow source/transaction trace verification is still required before release. Status 1 with a zero timestamp remains unresolved and is not claimed fixed.

New rounds snapshot a winning-support quorum of ceil(parent supply / 1000), corresponding to 0.1%. A late change of leading proposal extends voting until five minutes after that vote, with an absolute cap one hour beyond the original deadline. Same-leader increases do not extend voting. Proposals on the version-3 profile escrow 0.05 SOL in their candidate accounts, separately from rent and the proposal fee. After finalization, losers can reclaim the bond. Winners reclaim it only after successful child settlement; expired/orphaned winners forfeit it to treasury. Bond settlement is permissionless and binds recipients to stored proposer and configured treasury. Repeat settlement is rejected.

`enable_fee_sharing` activates version 3 on a fresh configuration. Epoch and Candidate layouts have appended fields; do not upgrade an existing devnet instance with live accounts without an explicit account migration. Existing devnet workers remain pinned and are not deployed from these changes. SDK decoders retain read compatibility with legacy account layouts, but that is not an on-chain migration.

All earlier artifact hashes are superseded for deployment by these Rust changes. A fresh SBF/IDL build, focused runtime review of the new governance instructions and timestamp verification remain pending. Hosting deployment holds remain in place.

## Audited build evidence and timestamp trace

The owner supplied a successful follow-up build from `b243e9cb6c02cb71daa0fa29478105a4a8fae46a`: 18 Rust tests, 70 client tests, 22 IDL instruction builders and no reported SBF stack overflow. The 796,968-byte program hash is `342d6c2a79cad8f9b176f7e2f8813490c9383b22066b646e190e4976b5cbe6ca`; IDL hash is `b5c79d5cda442445b4189dfb2d635e71b8eb195a2ed17a16704f220193c49ded`. See [validation/mainnet-audit-build-2026-10-11.json](validation/mainnet-audit-build-2026-10-11.json). This supersedes the earlier artifact records. No transactions were sent. Runtime verification and finding 2 remain pending.

A read-only history trace uses an existing graduated devnet token:

```bash
node scripts/devnet/trace-graduation-clock.mjs GKQWxEXuhPCKH4awCBJ4gb2QSiS2xEUcDxyFAwVTfrg6
```

It compares the final stored timestamp against the final curve buy and migration transaction. It classifies instructions only inside the canonical LaunchLab invocation and reports missing or same-second evidence as inconclusive. It sends no transaction and does not launch a token. The final account state cannot prove when the status-1 timestamp was first set or whether migration overwrote it, so this trace alone cannot close finding 2. A source verification or historical/live status-1 account snapshot is still required. Optional `TRACE_RPC_URL` may be configured privately for better history availability.

To directly observe an intermediate state without trading or deploying, run the bounded mainnet observer:

```bash
node scripts/production/observe-pending-migration.mjs
```

It scans finalized canonical LaunchLab SOL pools for up to five minutes, requiring status 1, a positive locked reserve, zero cliff/unlock, and a positive timestamp no later than the sampled block time. It validates owner, discriminator, canonical config and pool PDA; it saves the full public account bytes, hash and RPC context slot under `target/mainnet/status1-clock-*.json`. A captured snapshot demonstrates a nonzero timestamp before migration for that observed pool. It does not test the Stolons expiry transaction. No captured pool, unavailable scan/history, or rate limits are inconclusive outcomes, not release approval. A dedicated endpoint may be supplied privately as `OBSERVATION_RPC_URL`.

## Focused devnet runtime probe (owner authorized)

```bash
node scripts/devnet/verify-fundraising-clock.mjs --apply
```

This uses the existing version-2 devnet deployment. It transfers 1.3 test SOL from `keypairs/devnet-wallet.json` into a new dedicated test creator, launches one root with the current 70/15/15 allocation, then performs a signed simulation of the completing buy. Simulation returns the post-instruction pool and Clock sysvar together, so a migration crank cannot race that observation. The completing buy is never broadcast. The probe asserts status 1, zero cliff/unlock, exactly 150M locked, canonical pool identities, a 1 SOL devnet target, and a positive vesting timestamp equal to the simulated bank clock. It verifies the trace contains a buy and no migration instruction.

It writes public evidence to `target/devnet/fundraising-clock-test.json` and private test keys under ignored `keypairs/`. Funding and launch are real devnet transactions; the remaining balance stays in the test creator wallet. No mainnet funding, program upgrade, platform fee edit, migration or full lifecycle test is performed. A passed rerun returns the saved report. An unfinished run blocks automatic resubmission; inspect saved signatures first. This proves execution behavior of the deployed devnet buy code in simulation, not a live expiry transaction or the mainnet binary.

## Focused timestamp result — 2026-10-12

The owner completed the signed devnet buy simulation at slot 510077557. Its returned pool was status 1, with vesting start 1791763602 equal to the returned Clock sysvar. The buy trace contained no migration. The completing buy was not broadcast; the only submitted transactions were the earlier creator funding and root launch. Raw bytes and their independently checked hash are recorded in [validation/fundraising-clock-2026-10-12.json](validation/fundraising-clock-2026-10-12.json).

This resolves the question of whether the tested devnet LaunchLab buy sets a positive timestamp before migration. The status-1 expiry protection has supporting runtime evidence for that deployment. It does not establish behavior of the mainnet LaunchLab binary or exercise Stolons expiry/bond instructions. Those limits remain explicit in the release review. No further run of this probe is required, and hosting holds remain in place.

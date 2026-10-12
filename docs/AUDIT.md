# Mainnet source audit handoff

The `main` branch consolidates the latest protocol, SDK, frontend, fee collectors, production preparation tools, and the older validated-client fixes. The source ZIP excludes private key files, RPC credentials and generated build directories.

## Review target

- Mainnet program: `8uXCB9g8ctvVddm9W992KF862PX1gT5kijEQmbdbjQ8B`.
- Upgrade/config authority: `ABANF7g1F8UfAXEtBWVuFdodJ3QzAS9oTWj9fSoLx2MC`.
- Treasury: `FRVw3s9Wz4pKzRuUwEj9FZYa39vLbAfXzUqiDYAK2K87`.
- Dedicated keeper: `HwM5Ufv3yLLEemHeWqKhmctSCXM9K7Qbgp8hENrE84T2`.
- Planned platform PDA: `6izjBNnCfEGsijSLNXQsda7wr52iRQaixcbYYMXA1Tsd`.
- Planned protocol config PDA: `8pB76tPPCzV4eYRSUiewBnZGG9K4Vrj7njYyRm7x7A3u`.
- Planned reproduction authority: `BQEWHDiYSZW7WbFB1zsUtsrDPgPkPJS1gHbsyaWRrRfJ`.

These are intended or derived addresses. They do not establish deployed/initialized accounts. No mainnet transactions have been sent in the supplied preparation reports.

The revised program was built from `b243e9cb6c02cb71daa0fa29478105a4a8fae46a` using `scripts/production/build.sh`. That script archives committed source into an isolated directory and changes the Rust/Anchor identity in that copy to the mainnet program address. The repository's development identity and generated IDL are not themselves the mainnet artifact.

| Artifact | SHA-256 |
|---|---|
| Program, 796,968 bytes | `342d6c2a79cad8f9b176f7e2f8813490c9383b22066b646e190e4976b5cbe6ca` |
| Mainnet IDL | `b5c79d5cda442445b4189dfb2d635e71b8eb195a2ed17a16704f220193c49ded` |

The compiled artifacts are retained in the owner's `target/mainnet/`, not in the source ZIP. Preserve the generated `Cargo.lock` in the tested isolated build directory for dependency provenance; the Rust lockfile is not currently committed, so source alone does not pin every transitive Rust dependency. JavaScript dependencies are pinned by `pnpm-lock.yaml`.

## Current policy

New root and child launches use 700M curve tokens, 150M migration tokens and 150M reproduction reserve. The reserve, 10M parent burn and 15-direct-child limit are unchanged. Registration enforces the new curve allocation; previously registered tokens retain settlement compatibility. Live mainnet inspection accepted the allocation and 85 SOL fundraising target.

Curve platform and creator fees are each 0.10%. Reviewed Raydium curve protocol fees are 0.25%; CPMM trade and creator-stream rates are 0.25% and 0.05%. Net post-graduation creator receipts are split between protocol treasury and creator escrow using cumulative accounting. Creators claim manually; protocol fees are collected by backend workers. See [ECONOMICS.md](ECONOMICS.md), [FEES.md](FEES.md), and [INVARIANTS.md](INVARIANTS.md).

## Validation and remaining work

The owner supplied successful SBF/IDL compilation, no reported stack-frame overflow, 70 passing client tests, and passing live venue inspection. Earlier devnet family and fee reports are retained in `docs/validation/`. These checks are not an independent security audit or evidence of a live mainnet deployment.

Mainnet authority and keeper balances were zero at inspection. ProgramData rent was 3.98038828 SOL, excluding executable-account rent, temporary deploy buffer funding, transaction fees and initialization costs. Program deployment, platform/protocol initialization, lookup-table creation, funded mainnet workers, production RPC/storage configuration, and live production verification remain pending. The frontend's mainnet transactions remain disabled by default.

Review the outstanding adversarial and integration gates in [MAINNET.md](MAINNET.md). No further Railway/Vercel deployment is part of this audit handoff. The three Railway services that follow `main` use `/AUDIT_HOLD_DO_NOT_DEPLOY` as their watch pattern; restore intended watch patterns only when deployment is authorized. The existing devnet keeper remains pinned to its prior commit.

## Follow-up audit findings

The 85 SOL target is now enforced on-chain and in clients. Status-1 expiry protection is added and the focused devnet simulation now verifies a pre-migration timestamp. Mainnet binary equivalence and the Stolons instruction runtime checks remain open. The owner selected quorum, proposer bond and anti-sniping protections; they are implemented in version 3. The owner-supplied follow-up build passed 18 Rust tests, 70 client tests and SBF/IDL compilation with 22 instructions; the table above now records that revised artifact. Focused Stolons instruction runtime verification and mainnet timestamp verification remain pending. Review the new `settle_proposal_bond` instruction and appended Epoch/Candidate fields. No deployment or account migration is included.

## Focused timestamp result — 2026-10-12

The owner completed the signed devnet buy simulation at slot 510077557. Its returned pool was status 1, with vesting start 1791763602 equal to the returned Clock sysvar. The buy trace contained no migration. The completing buy was not broadcast; the only submitted transactions were the earlier creator funding and root launch. Raw bytes and their independently checked hash are recorded in [validation/fundraising-clock-2026-10-12.json](validation/fundraising-clock-2026-10-12.json).

This resolves the question of whether the tested devnet LaunchLab buy sets a positive timestamp before migration. The status-1 expiry protection has supporting runtime evidence for that deployment. It does not establish behavior of the mainnet LaunchLab binary or exercise Stolons expiry/bond instructions. Those limits remain explicit in the release review. No further run of this probe is required, and hosting holds remain in place.

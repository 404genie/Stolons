# Initial code logic review

## Findings fixed in this delivery

- A deep descendant can round the root-mass transfer down to zero. Epoch opening now performs the checked calculation before locking a parent into a round.
- Vote withdrawal now binds the escrow account to the epoch's parent mint and requires a voter-owned destination of the same mint.
- A candidate's migration cutoff is checked using LaunchLab's graduation timestamp, not the time a permissionless registrar happened to submit the instruction. Expiry also rechecks a migrated pool before orphaning it.
- Candidate migration checks the immutable LaunchLab pool and CPMM pool state without depending on the platform's current mutable configuration, so later platform edits cannot block a launch that already passed registration.
- Launch registrar signer must equal the creator recorded by LaunchLab.
- Proposal submission rejects a mint that already has a Stolons lineage.
- Reserve claim checks the exact incoming 150M delta, so an unrelated token donation to the vault cannot permanently block reserve activation.
- Final mutation verifies the candidate, child reserve, parent active state, family identity, and one-time settlement path before the burn.

## Current review status — 2026-10-11

The original delivery gates below have been superseded by the deployed devnet lifecycle and complete wallet frontend. LaunchLab/CPMM root and child flows, reserve claims and settlement were verified on devnet; SDK and frontend builds and JavaScript suites run locally. The most recent family confirms exactly 10M parent tokens burned, parent reserve 140M, active child reserve 150M, and conserved root ancestry mass.

The production review added upgrade-authority authorization to initialization through the canonical loader-owned ProgramData PDA. Previously any signer could race the one-time initializer. SDK account schemas and configuration tooling were updated. The supplied Codespaces build output confirms the initializer patch passes its Rust tests and SBF/IDL build. Fresh on-chain initialization rejection tests remain required; compilation alone is insufficient to approve the deployment.

The child metadata source patch now binds the matched atomic InitializeV2 name, ticker and URI to the selected proposal, including bounded malformed-input handling. It needs a new Rust/SBF build and devnet upgrade/integration tests. JSON content is still an off-chain hash commitment; the program does not fetch URLs. Mainnet transaction clients are still devnet-guarded; devnet economics have zero platform/creator fees and a 1 SOL graduation target. Durable hosting, mainnet identities, economics, integration review and the new artifact remain release gates.

See [MAINNET.md](MAINNET.md) for the current actionable review, production manifest/preflight, known limitations and validation evidence. This is an internal code review, not an independent audit or mainnet approval.

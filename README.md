# Stolons

Stolons is a Solana protocol for independently tradeable tokens with on-chain family lineage. Raydium LaunchLab creates and trades tokens; the Anchor program tracks family state, votes, reproduction reserves, and the fixed ancestry mutation.

This checkout is a complete first code delivery, not a deployed or devnet-verified release. The Rust/SBF program has not been compiled in this workspace because the Rust, Anchor, and Solana toolchains are unavailable here. Do not use the placeholder program ID for deployment.

## Repository

- `programs/stolons`: Anchor program and checked ancestry math.
- `sdk`: PDA derivation, instruction builders, lineage decoding, and LaunchLab transaction proof helper.
- `apps/web`: devnet-first lineage dashboard and epoch-opening screen.
- `services/indexer`: optional Anchor event indexer backed by PostgreSQL.
- `tests/unit`: deterministic integer-math and instruction/account-schema parity checks.
- `docs`: protocol invariants, Raydium integration pin, code logic review, and Devnet acceptance plan.

## Local checks

Install Node.js 20.11 or later and pnpm 11.25, then run:

```sh
pnpm install
pnpm test
pnpm sdk:build
pnpm web:build
pnpm indexer:build
```

With Rust 1.89, Solana/Agave 2.3, and Anchor CLI 0.32.2 installed, also run:

```sh
cargo test --workspace
anchor build
pnpm idl:sync
pnpm idl:check
```

The Node-only test suite runs without workspace package installation:

```sh
node --experimental-strip-types --test tests/unit/*.test.mjs
```

## Before Devnet

1. Generate a fresh deployment keypair and run `anchor keys sync`.
2. Verify the Raydium program IDs, cluster configs, quote mint, platform config, treasury, vesting wallet, and migration scales.
3. Build and review the SBF artifact, generated IDL, raw account layouts, CPI account order, and transaction composition.
4. Complete every step in [`docs/DEVNET.md`](docs/DEVNET.md), including failed and adversarial cases.

The web UI currently supports lineage inspection and opening an epoch. Other lifecycle actions are available as SDK builders but are not yet wired to web forms. The UI is a protocol development surface, not a mainnet launch application.

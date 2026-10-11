# Stolons

Stolons is a Solana protocol for independently tradeable tokens with on-chain family lineage. Raydium LaunchLab creates and trades tokens; the Anchor program tracks family state, votes, reproduction reserves, and the fixed ancestry mutation.

The `devnet/codespaces` branch has a deployed Devnet program and a verified root-to-child lifecycle: launch, governance, CPMM migration, reserve claiming, parent burn, and descendant activation. This is a development deployment; remaining acceptance scenarios are tracked in `docs/DEVNET.md`. See `docs/DEVNET-RESULTS.md` for public addresses and validation results.

## Repository

- `programs/stolons`: Anchor program and checked ancestry math.
- `sdk`: PDA derivation, instruction builders, lineage decoding, and LaunchLab transaction proof helper.
- `apps/web`: devnet-first lineage dashboard, epoch-opening screen, and wallet root launches with image upload and automatic token metadata.
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

The web UI supports lineage inspection, opening an epoch, and atomic root launches. Creators enter token details and upload an image; the app handles JSON creation and hosting. For deployed uploads, configure a public Blob store with the server-only `BLOB_READ_WRITE_TOKEN`; Devnet development uses local storage. See [`docs/DEVNET.md`](docs/DEVNET.md) for setup. Other lifecycle actions remain available through SDK builders and scripts. Mainnet launch remains disabled.

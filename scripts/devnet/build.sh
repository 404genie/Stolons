#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ -f "$DEVNET_PROGRAM_KEY" ] || { echo 'Run prepare.sh first.' >&2; exit 1; }
cmp -s "$DEVNET_PROGRAM_KEY" target/deploy/stolons-keypair.json || { echo 'Program key mismatch; run prepare.sh.' >&2; exit 1; }
pnpm install --frozen-lockfile
cargo test --workspace
pnpm test
mkdir -p target/devnet
anchor build 2>&1 | tee target/devnet/build.log
node scripts/check-sbf-stack.mjs target/devnet/build.log
pnpm idl:sync
pnpm idl:check
pnpm sdk:build
pnpm test:client
pnpm typecheck:clients
pnpm web:build
pnpm indexer:build
sha256sum target/deploy/stolons.so target/idl/stolons.json > target/devnet/build-sha256.txt

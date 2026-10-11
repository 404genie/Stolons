#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export KEEPER_CLUSTER=devnet
export KEEPER_RPC_URL="${DEVNET_FEE_RPC_URL:-https://api.devnet.solana.com}"
export KEEPER_PROGRAM_ID=4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ
export KEEPER_LOOKUP_TABLE="${NEXT_PUBLIC_LAUNCH_LOOKUP_TABLE:-88XLHEm7T4SEhSzMx3vqZjGXmzo2bbeJq4VK2sgJHGwx}"
export KEEPER_KEYPAIR_PATH=keypairs/devnet-fee-keeper.json
export KEEPER_WALLET="$(solana-keygen pubkey "$KEEPER_KEYPAIR_PATH")"
export TREASURY_KEYPAIR_PATH=keypairs/devnet-wallet.json
export TREASURY_WALLET="$(solana-keygen pubkey "$TREASURY_KEYPAIR_PATH")"
if [ "${1:-}" != '--apply' ]; then
  node services/keeper/fees.mjs
  node services/keeper/treasury.mjs --once
  exit
fi
# Separate subprocesses keep the treasury signing key out of CPMM collection.
node services/keeper/fees.mjs --apply --watch &
cpmm_worker=$!
node services/keeper/treasury.mjs --apply &
curve_worker=$!
trap 'kill "$cpmm_worker" "$curve_worker" 2>/dev/null || true' EXIT INT TERM
# If either fails, stop both for operator inspection; never blindly restart.
wait -n "$cpmm_worker" "$curve_worker"

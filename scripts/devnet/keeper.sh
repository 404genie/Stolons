#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export KEEPER_CLUSTER=devnet
export KEEPER_RPC_URL="${NEXT_PUBLIC_RPC_URL:-https://api.devnet.solana.com}"
export KEEPER_PROGRAM_ID="${NEXT_PUBLIC_STOLONS_PROGRAM_ID:-4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ}"
export KEEPER_KEYPAIR_PATH="${KEEPER_KEYPAIR_PATH:-$PWD/keypairs/devnet-wallet.json}"
export KEEPER_LOOKUP_TABLE="${NEXT_PUBLIC_LAUNCH_LOOKUP_TABLE:-88XLHEm7T4SEhSzMx3vqZjGXmzo2bbeJq4VK2sgJHGwx}"
node services/keeper/graduation.mjs "$@"

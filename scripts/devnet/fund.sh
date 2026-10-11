#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ -f "$DEVNET_WALLET" ] || { echo 'Run prepare.sh first.' >&2; exit 1; }
solana airdrop 2 --url "$DEVNET_RPC" --keypair "$DEVNET_WALLET"
solana balance --url "$DEVNET_RPC" --keypair "$DEVNET_WALLET"

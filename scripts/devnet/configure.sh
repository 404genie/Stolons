#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ -f "$DEVNET_WALLET" ] && [ -f "$DEVNET_PROGRAM_KEY" ] || { echo 'Run prepare.sh first.' >&2; exit 1; }
node sdk/scripts/configure-devnet.mjs "$(solana-keygen pubkey "$DEVNET_WALLET")" "$(solana-keygen pubkey "$DEVNET_PROGRAM_KEY")" "${1:-}"

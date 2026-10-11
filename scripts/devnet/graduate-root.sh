#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
node sdk/scripts/graduate-root-devnet.mjs "$(solana-keygen pubkey "$DEVNET_WALLET")" "$(solana-keygen pubkey "$DEVNET_PROGRAM_KEY")" "$(solana-keygen pubkey keypairs/devnet-root-mint.json)" "${1:-}"

#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ -f "$DEVNET_WALLET" ] && [ -f "$DEVNET_PROGRAM_KEY" ] || { echo 'Run prepare.sh first.' >&2; exit 1; }
umask 077
if [ ! -f keypairs/devnet-root-mint.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile keypairs/devnet-root-mint.json
fi
node sdk/scripts/launch-root-devnet.mjs "$(solana-keygen pubkey "$DEVNET_WALLET")" "$(solana-keygen pubkey "$DEVNET_PROGRAM_KEY")" "$(solana-keygen pubkey keypairs/devnet-root-mint.json)" "${1:-}"

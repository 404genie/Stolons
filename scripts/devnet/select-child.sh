#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
umask 077
if [ ! -f keypairs/devnet-child-mint.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile keypairs/devnet-child-mint.json
fi
node sdk/scripts/select-child-devnet.mjs "$(solana-keygen pubkey "$DEVNET_WALLET")" "$(solana-keygen pubkey "$DEVNET_PROGRAM_KEY")" "$(solana-keygen pubkey keypairs/devnet-root-mint.json)" "$(solana-keygen pubkey keypairs/devnet-child-mint.json)" "${1:-}"

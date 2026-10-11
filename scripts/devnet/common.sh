#!/usr/bin/env bash
# Source from each command; all transactions use this fixed Devnet endpoint.
set -euo pipefail
STOLONS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$STOLONS_ROOT"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cache/stolons-anchor/bin:$PATH"
DEVNET_RPC="https://api.devnet.solana.com"
DEVNET_WALLET="$STOLONS_ROOT/keypairs/devnet-wallet.json"
DEVNET_PROGRAM_KEY="$STOLONS_ROOT/keypairs/stolons-devnet-program.json"
for tool in solana solana-keygen anchor pnpm; do
  command -v "$tool" >/dev/null || { printf 'Missing tool: %s. Finish Codespaces setup first.\n' "$tool" >&2; exit 1; }
done

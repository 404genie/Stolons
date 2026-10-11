#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
export NEXT_PUBLIC_RPC_URL="$DEVNET_RPC"
export NEXT_PUBLIC_STOLONS_PROGRAM_ID="$(solana-keygen pubkey "$DEVNET_PROGRAM_KEY")"
if [[ -z "${NEXT_PUBLIC_LAUNCH_LOOKUP_TABLE:-}" && -f target/devnet/child-launch-table.json ]]; then
  export NEXT_PUBLIC_LAUNCH_LOOKUP_TABLE="$(node -e "console.log(JSON.parse(require('node:fs').readFileSync('target/devnet/child-launch-table.json','utf8')).table)")"
fi
pnpm sdk:build
exec pnpm --filter @stolons/web dev --hostname 0.0.0.0 --port 3000

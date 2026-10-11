#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
export NEXT_PUBLIC_RPC_URL="$DEVNET_RPC"
export NEXT_PUBLIC_STOLONS_PROGRAM_ID="$(solana-keygen pubkey "$DEVNET_PROGRAM_KEY")"
exec pnpm --filter @stolons/web dev --hostname 0.0.0.0 --port 3000

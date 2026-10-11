#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ -f "$DEVNET_WALLET" ] && [ -f "$DEVNET_PROGRAM_KEY" ] || { echo 'Run prepare.sh first.' >&2; exit 1; }
[ -f target/devnet/build-sha256.txt ] || { echo 'Run build.sh first.' >&2; exit 1; }
sha256sum --check target/devnet/build-sha256.txt
cmp -s "$DEVNET_PROGRAM_KEY" target/deploy/stolons-keypair.json || { echo 'Program key mismatch.' >&2; exit 1; }
program_id="$(solana-keygen pubkey "$DEVNET_PROGRAM_KEY")"
node --input-type=module - "$program_id" <<'JS'
import { readFileSync } from 'node:fs';
const idl=JSON.parse(readFileSync('target/idl/stolons.json','utf8'));
if(idl.address!==process.argv[2]) throw new Error('IDL does not match the deployment key; run build.sh again.');
JS
solana balance --url "$DEVNET_RPC" --keypair "$DEVNET_WALLET"
solana program deploy target/deploy/stolons.so --program-id "$DEVNET_PROGRAM_KEY" --url "$DEVNET_RPC" --keypair "$DEVNET_WALLET"
solana program show "$program_id" --url "$DEVNET_RPC" --keypair "$DEVNET_WALLET" > target/devnet/program-show.txt
printf 'Deployed on Devnet: %s\n' "$program_id"
printf 'Explorer: https://explorer.solana.com/address/%s?cluster=devnet\n' "$program_id"

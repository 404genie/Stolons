#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
umask 077
mkdir -p keypairs target/deploy
if [ ! -f "$DEVNET_WALLET" ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile "$DEVNET_WALLET"
fi
if [ ! -f "$DEVNET_PROGRAM_KEY" ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile "$DEVNET_PROGRAM_KEY"
fi
if [ -f target/deploy/stolons-keypair.json ] && ! cmp -s "$DEVNET_PROGRAM_KEY" target/deploy/stolons-keypair.json; then
  printf 'Existing target/deploy program key differs. Preserve it and resolve the identity before continuing.\n' >&2
  exit 1
fi
cp "$DEVNET_PROGRAM_KEY" target/deploy/stolons-keypair.json
anchor keys sync
program_id="$(solana-keygen pubkey "$DEVNET_PROGRAM_KEY")"
python3 - "$program_id" <<'PY'
import sys
from pathlib import Path
program = sys.argv[1]
for filename, entries in [
 ('apps/web/.env.local', {'NEXT_PUBLIC_STOLONS_PROGRAM_ID':program,'NEXT_PUBLIC_RPC_URL':'https://api.devnet.solana.com'}),
 ('services/indexer/.env', {'STOLONS_PROGRAM_ID':program,'SOLANA_RPC_URL':'https://api.devnet.solana.com'})]:
 p=Path(filename)
 lines=p.read_text().splitlines() if p.exists() else []
 lines=[s for s in lines if s.split('=',1)[0] not in entries]
 p.write_text('\n'.join(lines+[f'{k}={v}' for k,v in entries.items()])+'\n')
PY
printf 'Devnet wallet: %s\nProgram ID: %s\n' "$(solana-keygen pubkey "$DEVNET_WALLET")" "$program_id"
printf 'Request test SOL: bash scripts/devnet/fund.sh\nThen build: bash scripts/devnet/build.sh\n'

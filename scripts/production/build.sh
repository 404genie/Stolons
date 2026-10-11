#!/usr/bin/env bash
# Builds committed source in an isolated workspace. No RPC or transactions.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cache/stolons-anchor/bin:$PATH"
for tool in git python3 solana-keygen anchor cargo pnpm; do
  command -v "$tool" >/dev/null || { printf 'Missing tool: %s\n' "$tool" >&2; exit 1; }
done
manifest="$root/target/mainnet/manifest.json"
program_key="$root/keypairs/stolons-mainnet-program.json"
authority_key="$root/keypairs/stolons-mainnet-authority.json"
program_id="$(solana-keygen pubkey "$program_key")"
authority_id="$(solana-keygen pubkey "$authority_key")"
python3 - "$manifest" "$program_id" "$authority_id" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
assert m['cluster']=='mainnet-beta', 'Manifest cluster mismatch'
assert m['programId']==sys.argv[2], 'Program key mismatch'
assert m['upgradeAuthority']==sys.argv[3], 'Upgrade authority key mismatch'
assert m['configAuthority']==sys.argv[3], 'Configuration authority key mismatch'
assert m['programId']!='4GreceHsQNZWernuHmXYrfY7z5S62qrue21ZueJqZ8pJ', 'Cannot build mainnet with devnet identity'
PY
umask 077
mkdir -p target/mainnet
build_dir="$(mktemp -d "$root/target/mainnet/build-XXXXXX")"
git archive HEAD | tar -x -C "$build_dir"
python3 - "$build_dir" "$program_id" "$authority_key" <<'PY'
from pathlib import Path
import re,sys
root=Path(sys.argv[1]);program=sys.argv[2]
p=root/'programs/stolons/src/lib.rs'
s,n=re.subn(r'declare_id!\("[^"]+"\)',f'declare_id!("{program}")',p.read_text())
assert n==1, 'Expected exactly one program declaration'
p.write_text(s)
p=root/'Anchor.toml';s=p.read_text()
s=re.sub(r'(?m)^stolons = "[^"]+"',f'stolons = "{program}"',s)
s=re.sub(r'(?m)^cluster = "[^"]+"','cluster = "Mainnet"',s)
s=re.sub(r'(?m)^wallet = "[^"]+"',f'wallet = "{sys.argv[3]}"',s)
if '[programs.mainnet]' not in s:s+=f'\n[programs.mainnet]\nstolons = "{program}"\n'
p.write_text(s)
PY
mkdir -p "$build_dir/target/deploy"
cp "$program_key" "$build_dir/target/deploy/stolons-keypair.json"
cd "$build_dir"
pnpm install --frozen-lockfile
cargo test --workspace
pnpm test
anchor build 2>&1 | tee "$root/target/mainnet/build.log"
node scripts/check-sbf-stack.mjs "$root/target/mainnet/build.log"
pnpm idl:sync
pnpm idl:check
pnpm sdk:build
pnpm test:client
python3 - "$program_id" <<'PY'
import json,sys
m=json.load(open('target/idl/stolons.json'))
assert m.get('address')==sys.argv[1], 'Built IDL program address mismatch'
PY
cp target/deploy/stolons.so "$root/target/mainnet/stolons.so"
cp target/idl/stolons.json "$root/target/mainnet/stolons.json"
cd "$root"
sha256sum target/mainnet/stolons.so target/mainnet/stolons.json > target/mainnet/build-sha256.txt
git rev-parse HEAD > target/mainnet/source-commit.txt
printf 'Mainnet build complete for %s. No transactions sent.\nArtifacts: target/mainnet/\nIsolated build workspace: %s\n' "$program_id" "$build_dir"

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
sudo apt-get update
sudo apt-get install --yes build-essential libudev-dev pkg-config
if ! "$HOME/.local/share/solana/install/active_release/bin/solana" --version 2>/dev/null | grep -q '2\.3\.0'; then
  sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.0/install)"
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cache/stolons-anchor/bin:$PATH"
if ! anchor --version 2>/dev/null | grep -q '0\.32\.2'; then
  cargo install --root "$HOME/.cache/stolons-anchor" --git https://github.com/solana-foundation/anchor --tag v0.32.2 anchor-cli --locked
fi
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm sdk:build
printf '\nToolchain ready. Run: bash scripts/devnet/prepare.sh\n'

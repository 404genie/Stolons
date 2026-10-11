#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
node scripts/devnet/enable-fees.mjs "$@"

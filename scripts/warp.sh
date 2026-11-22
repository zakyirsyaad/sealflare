#!/usr/bin/env bash
# Moves the local chain's clock forward: scripts/warp.sh <seconds>
set -euo pipefail

SECONDS_FORWARD="${1:?usage: warp.sh <seconds>}"
[[ "$SECONDS_FORWARD" =~ ^[0-9]+$ ]] || { echo "seconds must be a whole number" >&2; exit 1; }
RPC_URL="http://127.0.0.1:8545"

cast rpc evm_increaseTime "$SECONDS_FORWARD" --rpc-url "$RPC_URL" >/dev/null
cast rpc evm_mine --rpc-url "$RPC_URL" >/dev/null
echo "Local chain time is now $(cast block latest --field timestamp --rpc-url "$RPC_URL")"

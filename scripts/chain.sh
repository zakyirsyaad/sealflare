#!/usr/bin/env bash
# Starts a local Anvil node and deploys the stub contracts to it.
# Addresses are written to shared/abi/addresses.local.json. Stop with Ctrl+C.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC_URL="http://127.0.0.1:8545"
# First account of Anvil's public development mnemonic.
SENDER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --silent &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 50); do
  if cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
cast chain-id --rpc-url "$RPC_URL" >/dev/null || { echo "Anvil did not start on $RPC_URL" >&2; exit 1; }

forge script DeployLocal --root "$ROOT/contracts" --rpc-url "$RPC_URL" \
  --broadcast --unlocked --sender "$SENDER" >/dev/null

echo "Local chain ready on $RPC_URL"
cat "$ROOT/shared/abi/addresses.local.json"
echo
wait "$ANVIL_PID"

#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export INFOHUB_API_URL="${INFOHUB_API_URL:-http://127.0.0.1/api}"
export INFOHUB_TOKEN_FILE="${INFOHUB_TOKEN_FILE:-$HOME/Library/Application Support/AIReise/secrets/I10/radius-reader-key}"
exec python3 "$ROOT/scripts/radius/mcp_server.py"

#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/portable/export-bundle.sh"

if grep -Eq 'docker[[:space:]]+compose.*[[:space:]]config|docker-compose\.resolved|docker-compose\.config\.log' "$SCRIPT"; then
  echo "portable artifact policy failed: rendered Compose output is forbidden" >&2
  exit 1
fi

if ! grep -Fq '"$SYSTEM_DIR/docker-compose.template.yml"' "$SCRIPT"; then
  echo "portable artifact policy failed: raw Compose template copy is missing" >&2
  exit 1
fi

echo "portable-artifact-policy: PASS"

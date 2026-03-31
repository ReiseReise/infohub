#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
  set +a
fi
cd "$ROOT_DIR/services/hub-engine"

LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-postgres://postgres:${PG_PASSWORD:-infohub_dev_2026}@127.0.0.1:5432/infohub}"
LOCAL_REDIS_URL="${LOCAL_REDIS_URL:-redis://127.0.0.1:6379}"

DATABASE_URL="$LOCAL_DATABASE_URL" \
REDIS_URL="$LOCAL_REDIS_URL" \
npx tsx scripts/cleanup-stale-fetch-jobs.ts

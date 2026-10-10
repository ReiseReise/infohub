#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUNTIME_ENV="${AIREISE_DATA_HOME:-$HOME/Library/Application Support/AIReise/data}/I10/runtime/radius-deployment/runtime.env"
if [[ ! -f "$RUNTIME_ENV" ]]; then
  echo '信息半径尚未完成本机部署配置。' >&2
  exit 1
fi
exec docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" --env-file "$RUNTIME_ENV" -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.radius.yml" "$@"

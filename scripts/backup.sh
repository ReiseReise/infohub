#!/usr/bin/env bash
# 兼容入口：统一走 portable 快照 + 可选 OSS 归档

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$ROOT_DIR/scripts/portable/backup-archive.sh" "$@"

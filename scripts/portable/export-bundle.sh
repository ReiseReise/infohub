#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — 单仓库可迁移包导出
# 模块：
#   01-system  系统运行骨架（Compose 原始模板 / README / manifest）
#   02-config  敏感配置（.env，默认 fail-safe）
#   03-data    订阅/用户/条目等数据库 + 导出文件 + 上传文件
# 用法：
#   bash scripts/portable/export-bundle.sh [output_dir] [--plain-env]
#   PORTABLE_PASSPHRASE=xxx bash scripts/portable/export-bundle.sh
# ============================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/portable-bundles"
PLAIN_ENV=false
SKIP_CONFIG=false
SKIP_DATA=false
CONFIG_INCLUDED=true
DATA_INCLUDED=true
CONFIG_INCLUDED_PY=True
DATA_INCLUDED_PY=True

# shellcheck source=config-policy.sh
source "$ROOT_DIR/scripts/portable/config-policy.sh"

for arg in "$@"; do
  case "$arg" in
    --plain-env) PLAIN_ENV=true ;;
    --skip-config) SKIP_CONFIG=true; CONFIG_INCLUDED=false; CONFIG_INCLUDED_PY=False ;;
    --skip-data) SKIP_DATA=true; DATA_INCLUDED=false; DATA_INCLUDED_PY=False ;;
    *)
      if [[ "$arg" != --* ]] && [ "$OUTPUT_DIR" = "$ROOT_DIR/portable-bundles" ]; then
        OUTPUT_DIR="$arg"
      fi
      ;;
  esac
done

HAS_ENV=false
HAS_PASSPHRASE=false
[ -f "$ROOT_DIR/.env" ] && HAS_ENV=true
[ -n "${PORTABLE_PASSPHRASE:-}" ] && HAS_PASSPHRASE=true
CONFIG_MODE="$(resolve_portable_config_mode "$HAS_ENV" "$HAS_PASSPHRASE" "$PLAIN_ENV" "$SKIP_CONFIG")"
if [ "$CONFIG_MODE" = "refused" ]; then
  echo "检测到 .env，但未提供 PORTABLE_PASSPHRASE，也未显式使用 --plain-env；已在创建输出目录和调用 Docker 前停止。" >&2
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BUNDLE_NAME="infohub-v3-portable-$TIMESTAMP"
WORK_DIR="$OUTPUT_DIR/$BUNDLE_NAME"
SYSTEM_DIR="$WORK_DIR/01-system"
CONFIG_DIR="$WORK_DIR/02-config"
DATA_DIR="$WORK_DIR/03-data"

mkdir -p "$SYSTEM_DIR" "$CONFIG_DIR" "$DATA_DIR"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令: $1" >&2
    exit 1
  }
}

wait_for_postgres() {
  local retries=30
  while [ "$retries" -gt 0 ]; do
    if docker exec infohub-postgres pg_isready -U postgres -d infohub >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    retries=$((retries - 1))
  done
  echo "Postgres 未就绪，无法导出数据" >&2
  exit 1
}

copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [ -e "$src" ]; then
    cp -R "$src" "$dst"
  fi
}

need_cmd docker
need_cmd tar

echo "📦 导出信息中枢 v3 可迁移包 → $WORK_DIR"

echo "[1/3] 导出 system 模块..."
cp "$ROOT_DIR/README.md" "$SYSTEM_DIR/README.md"
# Never render Compose with .env values: the portable system module carries
# only the checked-in template and the separately protected config module.
cp "$ROOT_DIR/docker-compose.yml" "$SYSTEM_DIR/docker-compose.template.yml"
cp "$ROOT_DIR/.env.example" "$SYSTEM_DIR/.env.example"
cp "$ROOT_DIR/Makefile" "$SYSTEM_DIR/Makefile"
mkdir -p "$SYSTEM_DIR/docs/operations"
copy_if_exists "$ROOT_DIR/docs/05-运维与使用手册.md" "$SYSTEM_DIR/docs/05-运维与使用手册.md"
copy_if_exists "$ROOT_DIR/docs/00-文档总导航.md" "$SYSTEM_DIR/docs/00-文档总导航.md"
copy_if_exists "$ROOT_DIR/docs/02-当前状态与功能地图.md" "$SYSTEM_DIR/docs/02-当前状态与功能地图.md"
copy_if_exists "$ROOT_DIR/docs/source-registry" "$SYSTEM_DIR/docs/source-registry"

SYSTEM_FILE_COUNT="$(find "$SYSTEM_DIR" -type f | wc -l | tr -d ' ')"

echo "[2/3] 导出 config 模块..."
if [ "$SKIP_CONFIG" = true ]; then
  echo "  ⤷ 跳过 config 模块"
elif [ -f "$ROOT_DIR/.env" ]; then
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ROOT_DIR/.env" | cut -d '=' -f1 > "$CONFIG_DIR/env.keys.txt" || true
  if [ "$CONFIG_MODE" = "encrypted" ]; then
    need_cmd openssl
    openssl enc -aes-256-cbc -pbkdf2 -salt \
      -in "$ROOT_DIR/.env" \
      -out "$CONFIG_DIR/.env.enc" \
      -pass env:PORTABLE_PASSPHRASE
  elif [ "$CONFIG_MODE" = "plaintext" ]; then
    cp "$ROOT_DIR/.env" "$CONFIG_DIR/.env.plaintext"
  fi
  cp "$ROOT_DIR/.env.example" "$CONFIG_DIR/.env.example"
else
  echo "  ⚠ 根目录不存在 .env，config 模块为空"
fi

echo "[3/3] 导出 data 模块..."
DB_ROWS_JSON='{}'
if [ "$SKIP_DATA" = true ]; then
  echo "  ⤷ 跳过 data 模块"
  DATA_MODE="skipped"
else
  DATA_MODE="included"
  mkdir -p "$DATA_DIR/postgres" "$DATA_DIR/files"
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d postgres >/dev/null
  wait_for_postgres

  docker exec infohub-postgres pg_dump -U postgres -d infohub --no-owner --no-privileges \
    > "$DATA_DIR/postgres/infohub.sql"

  USERS_COUNT="$(docker exec infohub-postgres psql -U postgres -d infohub -Atc "SELECT COUNT(*) FROM auth.users" 2>/dev/null || echo 0)"
  SOURCES_COUNT="$(docker exec infohub-postgres psql -U postgres -d infohub -Atc "SELECT COUNT(*) FROM hub.sources" 2>/dev/null || echo 0)"
  ITEMS_COUNT="$(docker exec infohub-postgres psql -U postgres -d infohub -Atc "SELECT COUNT(*) FROM hub.items" 2>/dev/null || echo 0)"
  FETCH_LOGS_COUNT="$(docker exec infohub-postgres psql -U postgres -d infohub -Atc "SELECT COUNT(*) FROM hub.fetch_logs" 2>/dev/null || echo 0)"
  AUDIO_TASKS_COUNT="$(docker exec infohub-postgres psql -U postgres -d infohub -Atc "SELECT COUNT(*) FROM audio.tasks" 2>/dev/null || echo 0)"
  DB_ROWS_JSON="$(python3 - <<PY
import json
print(json.dumps({
  "users": int("${USERS_COUNT:-0}" or 0),
  "sources": int("${SOURCES_COUNT:-0}" or 0),
  "items": int("${ITEMS_COUNT:-0}" or 0),
  "fetchLogs": int("${FETCH_LOGS_COUNT:-0}" or 0),
  "audioTasks": int("${AUDIO_TASKS_COUNT:-0}" or 0),
}, ensure_ascii=False))
PY
)"

  for dir_name in knowledge audio-uploads changedetection ntfy dibao; do
    if [ -d "$ROOT_DIR/data/$dir_name" ]; then
      cp -R "$ROOT_DIR/data/$dir_name" "$DATA_DIR/files/$dir_name"
    fi
  done
fi

python3 - <<PY
import json
from pathlib import Path

manifest = {
    "bundleVersion": 1,
    "project": "信息中枢 v3",
    "createdAt": "${TIMESTAMP}",
    "modules": {
        "system": {
            "included": True,
            "fileCount": int("${SYSTEM_FILE_COUNT:-0}" or 0),
        },
        "config": {
            "included": ${CONFIG_INCLUDED_PY},
            "mode": "${CONFIG_MODE}",
        },
        "data": {
            "included": ${DATA_INCLUDED_PY},
            "mode": "${DATA_MODE}",
            "dbRows": ${DB_ROWS_JSON},
        },
    },
    "restoreNotes": [
        "代码通过 Git / 文件同步迁移，01-system 只保留未展开环境变量的 docker-compose.template.yml。",
        "若 02-config 中存在 .env.enc，导入时需提供 PORTABLE_PASSPHRASE。",
        "03-data 恢复会覆盖当前数据库与 data/ 下对应目录，导入前请做好备份。",
        "Redis 只承载可重建的队列与缓存，不复制运行中的 data/redis 热目录。"
    ]
}
Path("${WORK_DIR}/portable-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
PY

tar -czf "$OUTPUT_DIR/$BUNDLE_NAME.tar.gz" -C "$OUTPUT_DIR" "$BUNDLE_NAME"

echo "✅ 导出完成"
echo "   目录: $WORK_DIR"
echo "   压缩包: $OUTPUT_DIR/$BUNDLE_NAME.tar.gz"
echo "   config 模块: $CONFIG_MODE"
if [ "$CONFIG_MODE" = "plaintext" ]; then
  echo "   提醒: 已通过显式 --plain-env 逃生口导出明文 .env，请限制访问并尽快改用加密包。"
fi

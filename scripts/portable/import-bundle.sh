#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — 可迁移包恢复
# 用法：
#   bash scripts/portable/import-bundle.sh <bundle.tar.gz|bundle_dir> --yes
# 可选：
#   --skip-config   仅恢复数据
#   --skip-data     仅恢复 .env
# 环境变量：
#   PORTABLE_PASSPHRASE=xxx   用于解密 .env.enc
# ============================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE_INPUT=""
CONFIRM_RESTORE=false
SKIP_CONFIG=false
SKIP_DATA=false

for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRM_RESTORE=true ;;
    --skip-config) SKIP_CONFIG=true ;;
    --skip-data) SKIP_DATA=true ;;
    *)
      if [ -z "$BUNDLE_INPUT" ]; then
        BUNDLE_INPUT="$arg"
      fi
      ;;
  esac
done

if [ -z "$BUNDLE_INPUT" ]; then
  echo "用法: bash scripts/portable/import-bundle.sh <bundle.tar.gz|bundle_dir> --yes" >&2
  exit 1
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令: $1" >&2
    exit 1
  }
}

wait_for_postgres() {
  local retries=30
  while [ "$retries" -gt 0 ]; do
    if docker exec infohub-postgres pg_isready -U postgres -d postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    retries=$((retries - 1))
  done
  echo "Postgres 未就绪，无法导入数据" >&2
  exit 1
}

need_cmd docker
need_cmd tar

TMP_DIR=""
BUNDLE_DIR=""

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

if [ -d "$BUNDLE_INPUT" ]; then
  BUNDLE_DIR="$BUNDLE_INPUT"
else
  TMP_DIR="$(mktemp -d)"
  tar -xzf "$BUNDLE_INPUT" -C "$TMP_DIR"
  MANIFEST_PATH="$(find "$TMP_DIR" -maxdepth 2 -name portable-manifest.json -print | head -n1)"
  if [ -n "$MANIFEST_PATH" ]; then
    BUNDLE_DIR="$(dirname "$MANIFEST_PATH")"
  fi
fi

if [ -z "$BUNDLE_DIR" ] || [ ! -f "$BUNDLE_DIR/portable-manifest.json" ]; then
  echo "未找到 portable-manifest.json，输入不是合法的信息中枢迁移包" >&2
  exit 1
fi

BACKUP_ROOT="$ROOT_DIR/migration-backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_ROOT"

echo "📥 恢复信息中枢 v3 迁移包 → $BUNDLE_DIR"
echo "   当前项目备份目录: $BACKUP_ROOT"

if [ "$SKIP_CONFIG" = false ]; then
  echo "[1/2] 恢复 config 模块..."
  mkdir -p "$BACKUP_ROOT/config"
  if [ -f "$ROOT_DIR/.env" ]; then
    cp "$ROOT_DIR/.env" "$BACKUP_ROOT/config/.env.before-import"
  fi

  if [ -f "$BUNDLE_DIR/02-config/.env.enc" ]; then
    need_cmd openssl
    if [ -z "${PORTABLE_PASSPHRASE:-}" ]; then
      echo "检测到加密 .env，但未提供 PORTABLE_PASSPHRASE" >&2
      exit 1
    fi
    openssl enc -d -aes-256-cbc -pbkdf2 \
      -in "$BUNDLE_DIR/02-config/.env.enc" \
      -out "$ROOT_DIR/.env" \
      -pass env:PORTABLE_PASSPHRASE
  elif [ -f "$BUNDLE_DIR/02-config/.env.plaintext" ]; then
    cp "$BUNDLE_DIR/02-config/.env.plaintext" "$ROOT_DIR/.env"
  else
    echo "  ⤷ 迁移包中没有 .env，跳过"
  fi
else
  echo "[1/2] 跳过 config 模块"
fi

if [ "$SKIP_DATA" = false ]; then
  if [ "$CONFIRM_RESTORE" = false ]; then
    echo "恢复 data 模块会覆盖当前数据库和 data/ 文件，请追加 --yes 再执行。" >&2
    exit 1
  fi

  echo "[2/2] 恢复 data 模块..."
  mkdir -p "$BACKUP_ROOT/data"

  docker compose -f "$ROOT_DIR/docker-compose.yml" stop \
    nginx hub-engine audio-service audio-worker audio-worker-asr changedetection ntfy rsshub >/dev/null 2>&1 || true

  for dir_name in knowledge audio-uploads changedetection ntfy; do
    if [ -d "$ROOT_DIR/data/$dir_name" ]; then
      mv "$ROOT_DIR/data/$dir_name" "$BACKUP_ROOT/data/$dir_name"
    fi
    if [ -d "$BUNDLE_DIR/03-data/files/$dir_name" ]; then
      mkdir -p "$ROOT_DIR/data"
      cp -R "$BUNDLE_DIR/03-data/files/$dir_name" "$ROOT_DIR/data/$dir_name"
    fi
  done

  if [ -f "$BUNDLE_DIR/03-data/postgres/infohub.sql" ]; then
    docker compose -f "$ROOT_DIR/docker-compose.yml" up -d postgres redis >/dev/null
    wait_for_postgres

    if docker exec infohub-postgres pg_dump -U postgres -d infohub --no-owner --no-privileges \
      > "$BACKUP_ROOT/data/pre-import-infohub.sql" 2>/dev/null; then
      :
    else
      rm -f "$BACKUP_ROOT/data/pre-import-infohub.sql"
    fi

    docker exec infohub-postgres psql -U postgres -d postgres -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'infohub' AND pid <> pg_backend_pid();" >/dev/null
    docker exec infohub-postgres psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS infohub;" >/dev/null
    docker exec infohub-postgres psql -U postgres -d postgres -c "CREATE DATABASE infohub;" >/dev/null
    docker exec -i infohub-postgres psql -U postgres -d infohub < "$BUNDLE_DIR/03-data/postgres/infohub.sql" >/dev/null
  else
    echo "  ⤷ 迁移包中没有数据库导出，跳过数据库恢复"
  fi

  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d --build >/dev/null
else
  echo "[2/2] 跳过 data 模块"
fi

echo "✅ 恢复完成"
echo "   .env 如已恢复，可直接执行：docker compose up -d --build"
echo "   旧配置和旧数据备份位于：$BACKUP_ROOT"

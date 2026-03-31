#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — 本地快照 + OSS 归档
# 用法：
#   bash scripts/portable/backup-archive.sh
# 行为：
#   1) 导出 portable bundle 到本地备份目录
#   2) 按保留数量清理旧的本地备份
#   3) 可选上传到 OSS，并按保留数量清理远端
#   4) 写入 backup-status.json 供管理端展示
# ============================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

normalize_bool() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) echo "true" ;;
    *) echo "false" ;;
  esac
}

resolve_host_path() {
  python3 - "$ROOT_DIR" "${1:-}" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
raw = (sys.argv[2] or "").strip() or "./backups"
path = Path(raw).expanduser()
if not path.is_absolute():
    path = (root / path).resolve()
print(path)
PY
}

find_latest_bundle() {
  python3 - "$1" <<'PY'
from pathlib import Path
import sys

backup_dir = Path(sys.argv[1])
files = sorted(backup_dir.glob("infohub-v3-portable-*.tar.gz"), key=lambda item: item.stat().st_mtime, reverse=True)
print(files[0] if files else "")
PY
}

prune_local_backups() {
  python3 - "$1" "$2" <<'PY'
from pathlib import Path
import json
import shutil
import sys

backup_dir = Path(sys.argv[1])
retention = max(int(sys.argv[2]), 1)
files = sorted(backup_dir.glob("infohub-v3-portable-*.tar.gz"), key=lambda item: item.stat().st_mtime, reverse=True)
removed: list[str] = []
for stale in files[retention:]:
    removed.append(stale.name)
    stale.unlink(missing_ok=True)
    bundle_dir = backup_dir / stale.name.removesuffix(".tar.gz")
    if bundle_dir.exists():
        shutil.rmtree(bundle_dir)
print(json.dumps(removed, ensure_ascii=False))
PY
}

write_status_file() {
  python3 - "$STATUS_FILE" <<'PY'
import json
import os
from pathlib import Path

status_file = Path(__import__("sys").argv[1])
status_file.parent.mkdir(parents=True, exist_ok=True)

def parse_json(name: str, fallback):
    raw = os.getenv(name, "")
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback

payload = {
    "updatedAt": os.getenv("STATUS_UPDATED_AT"),
    "status": os.getenv("STATUS_STATE"),
    "durationMs": int(os.getenv("STATUS_DURATION_MS", "0") or 0),
    "message": os.getenv("STATUS_MESSAGE", ""),
    "backupDir": os.getenv("STATUS_BACKUP_DIR", ""),
    "manualCommand": "bash scripts/portable/backup-archive.sh",
    "bundle": {
        "name": os.getenv("STATUS_BUNDLE_NAME") or None,
        "path": os.getenv("STATUS_BUNDLE_PATH") or None,
        "sizeBytes": int(os.getenv("STATUS_BUNDLE_SIZE", "0") or 0) if os.getenv("STATUS_BUNDLE_NAME") else None,
    },
    "localRetention": int(os.getenv("STATUS_LOCAL_RETENTION", "0") or 0),
    "localPruned": parse_json("STATUS_LOCAL_PRUNED", []),
    "remote": {
        "enabled": os.getenv("STATUS_REMOTE_ENABLED") == "true",
        "configured": os.getenv("STATUS_REMOTE_CONFIGURED") == "true",
        "status": os.getenv("STATUS_REMOTE_STATUS", "disabled"),
        "bucket": os.getenv("STATUS_REMOTE_BUCKET") or None,
        "prefix": os.getenv("STATUS_REMOTE_PREFIX") or None,
        "objectKey": os.getenv("STATUS_REMOTE_OBJECT_KEY") or None,
        "uploadedAt": os.getenv("STATUS_REMOTE_UPLOADED_AT") or None,
        "prunedKeys": parse_json("STATUS_REMOTE_PRUNED", []),
        "error": os.getenv("STATUS_REMOTE_ERROR") or None,
    },
}

status_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
PY
}

HOST_BACKUP_ROOT="${HOST_BACKUP_ROOT:-./backups}"
BACKUP_DIR="$(resolve_host_path "$HOST_BACKUP_ROOT")"
STATUS_FILE="$BACKUP_DIR/backup-status.json"
LOCAL_RETENTION="${BACKUP_LOCAL_RETENTION:-7}"
REMOTE_RETENTION="${BACKUP_OSS_RETENTION:-30}"
OSS_ENABLED="$(normalize_bool "${BACKUP_OSS_ENABLED:-false}")"
ALLOW_PLAINTEXT="$(normalize_bool "${BACKUP_ALLOW_PLAINTEXT:-false}")"
START_EPOCH_MS="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"

mkdir -p "$BACKUP_DIR"

STATUS_UPDATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
STATUS_STATE="failed"
STATUS_MESSAGE=""
STATUS_BACKUP_DIR="$BACKUP_DIR"
STATUS_BUNDLE_NAME=""
STATUS_BUNDLE_PATH=""
STATUS_BUNDLE_SIZE="0"
STATUS_LOCAL_RETENTION="$LOCAL_RETENTION"
STATUS_LOCAL_PRUNED="[]"
STATUS_REMOTE_ENABLED="$OSS_ENABLED"
STATUS_REMOTE_CONFIGURED="false"
STATUS_REMOTE_STATUS="disabled"
STATUS_REMOTE_BUCKET="${BACKUP_OSS_BUCKET:-}"
STATUS_REMOTE_PREFIX="${BACKUP_OSS_PREFIX:-infohub-v3/}"
STATUS_REMOTE_OBJECT_KEY=""
STATUS_REMOTE_UPLOADED_AT=""
STATUS_REMOTE_PRUNED="[]"
STATUS_REMOTE_ERROR=""

cleanup_and_write_status() {
  local end_ms duration_ms
  end_ms="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
  duration_ms="$((end_ms - START_EPOCH_MS))"

  export STATUS_UPDATED_AT STATUS_STATE STATUS_MESSAGE STATUS_BACKUP_DIR STATUS_BUNDLE_NAME STATUS_BUNDLE_PATH STATUS_BUNDLE_SIZE
  export STATUS_LOCAL_RETENTION STATUS_LOCAL_PRUNED STATUS_REMOTE_ENABLED STATUS_REMOTE_CONFIGURED STATUS_REMOTE_STATUS
  export STATUS_REMOTE_BUCKET STATUS_REMOTE_PREFIX STATUS_REMOTE_OBJECT_KEY STATUS_REMOTE_UPLOADED_AT STATUS_REMOTE_PRUNED STATUS_REMOTE_ERROR
  export STATUS_DURATION_MS="$duration_ms"
  write_status_file
}

write_status_now() {
  export STATUS_UPDATED_AT STATUS_STATE STATUS_MESSAGE STATUS_BACKUP_DIR STATUS_BUNDLE_NAME STATUS_BUNDLE_PATH STATUS_BUNDLE_SIZE
  export STATUS_LOCAL_RETENTION STATUS_LOCAL_PRUNED STATUS_REMOTE_ENABLED STATUS_REMOTE_CONFIGURED STATUS_REMOTE_STATUS
  export STATUS_REMOTE_BUCKET STATUS_REMOTE_PREFIX STATUS_REMOTE_OBJECT_KEY STATUS_REMOTE_UPLOADED_AT STATUS_REMOTE_PRUNED STATUS_REMOTE_ERROR
  export STATUS_DURATION_MS="0"
  write_status_file
}

trap cleanup_and_write_status EXIT

STATUS_STATE="running"
STATUS_MESSAGE="准备执行 portable 备份"
write_status_now

if [ -f "$ROOT_DIR/.env" ] && [ -z "${PORTABLE_PASSPHRASE:-}" ] && [ "$ALLOW_PLAINTEXT" != "true" ]; then
  STATUS_MESSAGE="缺少 PORTABLE_PASSPHRASE，已阻止明文备份"
  exit 1
fi

EXPORT_ARGS=("$BACKUP_DIR")
if [ -z "${PORTABLE_PASSPHRASE:-}" ] && [ "$ALLOW_PLAINTEXT" = "true" ]; then
  EXPORT_ARGS+=("--plain-env")
fi

echo "📦 执行 portable 备份 → $BACKUP_DIR"
bash "$ROOT_DIR/scripts/portable/export-bundle.sh" "${EXPORT_ARGS[@]}"

LATEST_BUNDLE="$(find_latest_bundle "$BACKUP_DIR")"
if [ -z "$LATEST_BUNDLE" ]; then
  STATUS_MESSAGE="portable 导出完成，但未找到生成的 tar.gz"
  exit 1
fi

STATUS_BUNDLE_PATH="$LATEST_BUNDLE"
STATUS_BUNDLE_NAME="$(basename "$LATEST_BUNDLE")"
STATUS_BUNDLE_SIZE="$(python3 - "$LATEST_BUNDLE" <<'PY'
from pathlib import Path
import sys
print(Path(sys.argv[1]).stat().st_size)
PY
)"

STATUS_LOCAL_PRUNED="$(prune_local_backups "$BACKUP_DIR" "$LOCAL_RETENTION")"
STATUS_MESSAGE="本地备份已生成"
STATUS_STATE="success"
write_status_now

REQUIRED_REMOTE_VARS=(
  "${BACKUP_OSS_BUCKET:-}"
  "${OSS_ACCESS_KEY_ID:-}"
  "${OSS_ACCESS_KEY_SECRET:-}"
)

REMOTE_CONFIGURED=true
for value in "${REQUIRED_REMOTE_VARS[@]}"; do
  if [ -z "$value" ]; then
    REMOTE_CONFIGURED=false
    break
  fi
done
STATUS_REMOTE_CONFIGURED="$(normalize_bool "$REMOTE_CONFIGURED")"

if [ "$OSS_ENABLED" = "true" ]; then
  if [ "$STATUS_REMOTE_CONFIGURED" != "true" ]; then
    STATUS_REMOTE_STATUS="failed"
    STATUS_REMOTE_ERROR="启用了 OSS 归档，但 BACKUP_OSS_BUCKET 或 OSS 凭证未配置完整"
    STATUS_STATE="partial"
    STATUS_MESSAGE="本地备份完成，OSS 归档未配置完整"
    exit 1
  fi

  STATUS_REMOTE_STATUS="running"
  STATUS_MESSAGE="本地备份已生成，正在上传 OSS"
  write_status_now

  echo "☁️ 上传备份到 OSS..."
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d audio-service >/dev/null
  CONTAINER_BUNDLE="/app/backups/$STATUS_BUNDLE_NAME"
  set +e
  UPLOAD_OUTPUT="$(
    docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T \
      -e BACKUP_OSS_BUCKET="${BACKUP_OSS_BUCKET:-}" \
      -e BACKUP_OSS_PREFIX="${BACKUP_OSS_PREFIX:-infohub-v3/}" \
      -e BACKUP_OSS_RETENTION="$REMOTE_RETENTION" \
      audio-service python3 - "$CONTAINER_BUNDLE" < "$ROOT_DIR/scripts/portable/oss_archive.py" 2>&1
  )"
  UPLOAD_RC=$?
  set -e

  if [ "$UPLOAD_RC" -ne 0 ]; then
    STATUS_REMOTE_STATUS="failed"
    STATUS_REMOTE_ERROR="$UPLOAD_OUTPUT"
    STATUS_STATE="partial"
    STATUS_MESSAGE="本地备份完成，OSS 上传失败"
    exit 1
  fi

  PARSED_UPLOAD="$(python3 - "$UPLOAD_OUTPUT" <<'PY'
import json
import sys

raw = sys.argv[1].strip()
payload = json.loads(raw)
print(json.dumps(payload, ensure_ascii=False))
PY
)"
  STATUS_REMOTE_STATUS="success"
  STATUS_REMOTE_OBJECT_KEY="$(python3 - "$PARSED_UPLOAD" <<'PY'
import json
import sys
print(json.loads(sys.argv[1]).get("object_key", ""))
PY
)"
  STATUS_REMOTE_UPLOADED_AT="$(python3 - "$PARSED_UPLOAD" <<'PY'
import json
import sys
print(json.loads(sys.argv[1]).get("uploaded_at", ""))
PY
)"
  STATUS_REMOTE_PRUNED="$(python3 - "$PARSED_UPLOAD" <<'PY'
import json
import sys
print(json.dumps(json.loads(sys.argv[1]).get("pruned_keys", []), ensure_ascii=False))
PY
)"
  STATUS_MESSAGE="本地备份与 OSS 归档已完成"
fi

echo "✅ 备份完成"
echo "   本地：$STATUS_BUNDLE_PATH"
if [ "$STATUS_REMOTE_STATUS" = "success" ]; then
  echo "   OSS：${STATUS_REMOTE_OBJECT_KEY}"
fi

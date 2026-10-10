#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BAIDU_ROOT="${INFOHUB_BAIDU_SYNC_ROOT:-/Users/reise/百度网盘同步/数字分身外置数据}"
SECRET_FILE="${INFOHUB_BACKUP_SECRET_FILE:-/Users/reise/Library/Application Support/AIReise/secrets/I10/infohub-baidu-recovery.pass}"
BUNDLE_PATH="${1:-}"

if [ -z "$BUNDLE_PATH" ]; then
  BUNDLE_PATH="$(find "$ROOT_DIR/backups" -maxdepth 1 -type f -name 'infohub-v3-portable-*.tar.gz' -print | sort | tail -n 1)"
fi

if [ ! -f "$BUNDLE_PATH" ]; then
  echo "未找到可同步的 portable 备份：$BUNDLE_PATH" >&2
  exit 1
fi

if [ ! -f "$SECRET_FILE" ]; then
  echo "缺少本地加密密钥文件：$SECRET_FILE" >&2
  exit 1
fi

if [ "$(stat -f '%Lp' "$SECRET_FILE")" != "600" ]; then
  echo "加密密钥权限必须是 600：$SECRET_FILE" >&2
  exit 1
fi

STAMP="$(basename "$BUNDLE_PATH" .tar.gz | sed 's/^infohub-v3-portable-//')"
CLUSTER_DIR="$BAIDU_ROOT/项目数据/基建/I10_信息中枢-v3/恢复副本/$STAMP"
FILES_DIR="$CLUSTER_DIR/文件"
ENCRYPTED_NAME="infohub-v3-recovery-$STAMP.tar.gz.enc"
ENCRYPTED_PATH="$FILES_DIR/$ENCRYPTED_NAME"

mkdir -p "$FILES_DIR"
chmod 700 "$CLUSTER_DIR" "$FILES_DIR"

echo "正在生成客户端加密恢复副本..."
/usr/bin/openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$BUNDLE_PATH" \
  -out "$ENCRYPTED_PATH" \
  -pass "file:$SECRET_FILE"

(
  cd "$FILES_DIR"
  shasum -a 256 "$ENCRYPTED_NAME" > "$CLUSTER_DIR/文件校验.sha256"
)

SOURCE_SIZE="$(stat -f '%z' "$BUNDLE_PATH")"
ENCRYPTED_SIZE="$(stat -f '%z' "$ENCRYPTED_PATH")"
CREATED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

python3 - "$CLUSTER_DIR/资料清单.json" <<PY
import json
import sys
from pathlib import Path

payload = {
    "project": "信息中枢-v3",
    "projectId": "I10",
    "createdAt": "$CREATED_AT",
    "backupKind": "encrypted-recovery-copy",
    "cloudStatus": "remote-declared",
    "encryption": {
        "cipher": "AES-256-CBC",
        "kdf": "PBKDF2",
        "iterations": 200000,
        "secretStoredOutsideSyncRoot": True,
    },
    "sourceBundle": {
        "name": "$(basename "$BUNDLE_PATH")",
        "sizeBytes": int("$SOURCE_SIZE"),
    },
    "files": [
        {
            "name": "$ENCRYPTED_NAME",
            "sizeBytes": int("$ENCRYPTED_SIZE"),
            "checksumFile": "文件校验.sha256",
        }
    ],
    "recoveryNotes": [
        "先使用恢复脚本校验密文哈希并解密。",
        "百度同步状态仅为客户端声明，不等同于已验证的异地灾备。",
        "加密密钥不在同步目录中，密钥丢失将无法恢复。",
    ],
}
Path(sys.argv[1]).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
PY

cat > "$CLUSTER_DIR/README.txt" <<EOF
信息中枢-v3 加密恢复副本

本目录只包含加密数据。恢复时在项目根目录执行：

  bash scripts/portable/verify-baidu-recovery.sh "$CLUSTER_DIR"

默认密钥位于本机 Application Support 私密目录，不在百度同步盘。
EOF

echo "加密恢复副本已生成：$CLUSTER_DIR"
echo "密文大小：$ENCRYPTED_SIZE bytes"

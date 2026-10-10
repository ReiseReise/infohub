#!/usr/bin/env bash

set -euo pipefail
umask 077

CLUSTER_DIR="${1:-}"
SECRET_FILE="${INFOHUB_BACKUP_SECRET_FILE:-/Users/reise/Library/Application Support/AIReise/secrets/I10/infohub-baidu-recovery.pass}"
OUTPUT_ROOT="${INFOHUB_RECOVERY_VERIFY_ROOT:-/Users/reise/Library/Application Support/AIReise/data/I10/recovery-verification}"

if [ -z "$CLUSTER_DIR" ] || [ ! -d "$CLUSTER_DIR" ]; then
  echo "用法：bash scripts/portable/verify-baidu-recovery.sh <恢复副本目录>" >&2
  exit 1
fi

if [ ! -f "$SECRET_FILE" ]; then
  echo "缺少本地加密密钥文件：$SECRET_FILE" >&2
  exit 1
fi

ENCRYPTED_PATH="$(find "$CLUSTER_DIR/文件" -maxdepth 1 -type f -name '*.tar.gz.enc' -print | head -n 1)"
if [ ! -f "$ENCRYPTED_PATH" ]; then
  echo "恢复副本中没有加密负载" >&2
  exit 1
fi

(
  cd "$CLUSTER_DIR/文件"
  shasum -a 256 -c "$CLUSTER_DIR/文件校验.sha256"
)

STAMP="$(basename "$CLUSTER_DIR")"
VERIFY_DIR="$OUTPUT_ROOT/$STAMP"
DECRYPTED_PATH="$VERIFY_DIR/infohub-v3-recovery-$STAMP.tar.gz"
mkdir -p "$OUTPUT_ROOT" "$VERIFY_DIR"
chmod 700 "$OUTPUT_ROOT" "$VERIFY_DIR"

/usr/bin/openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$ENCRYPTED_PATH" \
  -out "$DECRYPTED_PATH" \
  -pass "file:$SECRET_FILE"
chmod 600 "$DECRYPTED_PATH"

tar -tzf "$DECRYPTED_PATH" >/dev/null

echo "恢复副本校验通过：$CLUSTER_DIR"
echo "已解密验证到：$DECRYPTED_PATH"

#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HUB_URL="${HUB_ENGINE_URL:-http://127.0.0.1:3001}"

ADMIN_EMAIL="${ACCEPTANCE_ADMIN_EMAIL:-acceptance.admin@infohub.local}"
ADMIN_PASSWORD="${ACCEPTANCE_ADMIN_PASSWORD:-InfoHubAdmin2026}"
PACKAGE_SLUG="${PACKAGE_SLUG:-hn-popular-blogs}"
CATEGORY_DEFAULT="${CATEGORY_DEFAULT:-hn-popular-blogs}"
IMPORT_LIMIT="${IMPORT_LIMIT:-92}"

login_response="$(curl -fsS -X POST "$HUB_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")"

token="$(
  LOGIN_RESPONSE="$login_response" python3 - <<'PY'
import json
import os
payload = json.loads(os.environ["LOGIN_RESPONSE"])
print(payload.get("accessToken", ""))
PY
)"

if [ -z "$token" ]; then
  echo "未能获取管理员 token，无法导入 HN 测试包" >&2
  exit 1
fi

curl -fsS -X POST "$HUB_URL/api/subscriptions/packages/$PACKAGE_SLUG/import" \
  -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' \
  -d "{\"categoryDefault\":\"${CATEGORY_DEFAULT}\",\"limit\":${IMPORT_LIMIT}}" >/tmp/infohub-hn-package-import.json

python3 - <<'PY'
import json
from pathlib import Path
data = json.loads(Path("/tmp/infohub-hn-package-import.json").read_text())
summary = data.get("summary", {})
print("HN 测试包导入完成：")
print(f"  total={summary.get('total', 0)}")
print(f"  created={summary.get('created', 0)}")
print(f"  duplicates={summary.get('duplicates', 0)}")
print(f"  failed={summary.get('failed', 0)}")
PY

#!/usr/bin/env bash

# Usage:
#   source qa/helpers/auth.sh
#   qa_auth_init "http://localhost:3001" "tag"
#   api_curl "$BASE_URL/api/sources"
#   api_curl_code -X POST "$BASE_URL/api/sources" -H "Content-Type: application/json" -d '{}'

set -euo pipefail

QA_TOKEN=""
QA_EMAIL=""
QA_PASSWORD=""
QA_USERNAME=""

qa_auth_init() {
  local base_url="${1:?base_url required}"
  local suffix="${2:-$(date +%s)}"

  QA_EMAIL="qa_${suffix}@example.com"
  QA_USERNAME="qa_${suffix}"
  QA_PASSWORD="Passw0rd${suffix}"

  local register_resp
  register_resp=$(curl -s -X POST "$base_url/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$QA_EMAIL\",\"username\":\"$QA_USERNAME\",\"password\":\"$QA_PASSWORD\"}" 2>/dev/null || echo '{}')

  QA_TOKEN=$(echo "$register_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo "")
  if [ -z "$QA_TOKEN" ] || [ "$QA_TOKEN" = "None" ]; then
    local login_resp
    login_resp=$(curl -s -X POST "$base_url/api/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$QA_EMAIL\",\"password\":\"$QA_PASSWORD\"}" 2>/dev/null || echo '{}')
    QA_TOKEN=$(echo "$login_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo "")
  fi

  if [ -z "$QA_TOKEN" ] || [ "$QA_TOKEN" = "None" ]; then
    return 1
  fi

  return 0
}

api_curl() {
  curl -s -H "Authorization: Bearer $QA_TOKEN" "$@"
}

api_curl_code() {
  curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $QA_TOKEN" "$@"
}

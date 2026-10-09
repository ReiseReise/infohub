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
QA_CURL_CONNECT_TIMEOUT="${QA_CURL_CONNECT_TIMEOUT:-5}"
QA_CURL_MAX_TIME="${QA_CURL_MAX_TIME:-120}"

qa_auth_init() {
  local base_url="${1:?base_url required}"
  local suffix="${2:-$(date +%s)}"

  QA_EMAIL="qa_${suffix}@example.com"
  QA_USERNAME="qa_${suffix}"
  QA_PASSWORD="Passw0rd${suffix}"

  local register_resp
  register_resp=$(curl -s --connect-timeout "$QA_CURL_CONNECT_TIMEOUT" --max-time "$QA_CURL_MAX_TIME" \
    -X POST "$base_url/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$QA_EMAIL\",\"username\":\"$QA_USERNAME\",\"password\":\"$QA_PASSWORD\"}" 2>/dev/null || echo '{}')

  QA_TOKEN=$(echo "$register_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo "")
  if [ -z "$QA_TOKEN" ] || [ "$QA_TOKEN" = "None" ]; then
    local login_resp
    login_resp=$(curl -s --connect-timeout "$QA_CURL_CONNECT_TIMEOUT" --max-time "$QA_CURL_MAX_TIME" \
      -X POST "$base_url/api/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$QA_EMAIL\",\"password\":\"$QA_PASSWORD\"}" 2>/dev/null || echo '{}')
    QA_TOKEN=$(echo "$login_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo "")
  fi

  if [ -z "$QA_TOKEN" ] || [ "$QA_TOKEN" = "None" ]; then
    return 1
  fi

  return 0
}

# SEC-007: 测试结束时清掉自己注册的账号，避免僵尸账号累积。
# 2026-07-13 清理过 497 个，但生成端没堵，十一天内又长回 72 个。
# 直接走 psql 而非 API：删用户需要 admin 权限，而 QA 账号本身是普通用户。
# 静默失败——清理失败不应让测试用例判红。
qa_auth_cleanup() {
  [ -n "${QA_EMAIL:-}" ] || return 0
  [ "${QA_SKIP_CLEANUP:-0}" = "1" ] && return 0
  local container="${PG_CONTAINER:-infohub-postgres}"
  docker exec -i "$container" psql -U "${PG_USER:-postgres}" -d "${PG_DB:-infohub}" -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL || true
begin;
create temp table _victim on commit drop as
  select id from auth.users where email = '${QA_EMAIL}';
delete from audio.usage_logs     where user_id in (select id from _victim);
delete from audio.tasks          where user_id in (select id from _victim);
delete from public.usage_logs    where user_id in (select id from _victim);
delete from hub.ai_usage_logs    where user_id in (select id from _victim);
delete from hub.ai_configs       where user_id in (select id from _victim);
delete from hub.filter_rules     where user_id in (select id from _victim);
delete from hub.insights         where user_id in (select id from _victim);
delete from hub.quality_policies where user_id in (select id from _victim);
delete from hub.items            where user_id in (select id from _victim);
delete from hub.sources          where user_id in (select id from _victim);
delete from quota.user_quotas    where user_id in (select id from _victim);
delete from auth.invite_codes    where created_by in (select id from _victim)
                                    or used_by in (select id from _victim);
delete from public.invite_codes  where created_by in (select id from _victim);
delete from auth.users           where id in (select id from _victim);
commit;
SQL
  QA_EMAIL=""
  QA_TOKEN=""
  return 0
}

# 让 source 本文件的脚本无需显式调用也能在退出时清理
qa_auth_enable_autocleanup() {
  trap 'qa_auth_cleanup' EXIT
}

api_curl() {
  curl -s --connect-timeout "$QA_CURL_CONNECT_TIMEOUT" --max-time "$QA_CURL_MAX_TIME" \
    -H "Authorization: Bearer $QA_TOKEN" "$@"
}

api_curl_code() {
  curl -s --connect-timeout "$QA_CURL_CONNECT_TIMEOUT" --max-time "$QA_CURL_MAX_TIME" \
    -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $QA_TOKEN" "$@"
}

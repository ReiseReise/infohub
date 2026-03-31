#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — 真实平台音频 URL 烟测
# 用法：bash qa/p0/test_audio_url_real_platforms.sh
# 目标：
#   1. 覆盖页面型播客链接、直链音频、可选 YouTube
#   2. 验证 from-url 至少完成“创建任务 -> 解析/下载 -> 预处理”
#   3. 若因 ASR 凭证缺失失败，也要明确判定为“下载链路成功，转写环境未配置”
# 说明：
#   - 不纳入默认 make gate
#   - 可通过 qa/fixtures/audio-real-urls.env 覆盖 URL
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
PASS=0; FAIL=0; SKIP=0

log()  { printf "%b[QA]%b %s\n" "$CYAN" "$RESET" "$*"; }
pass() { printf "%b[PASS]%b %s\n" "$GREEN" "$RESET" "$*"; PASS=$((PASS+1)); }
fail() { printf "%b[FAIL]%b %s\n" "$RED" "$RESET" "$*"; FAIL=$((FAIL+1)); }
skip() { printf "%b[SKIP]%b %s\n" "$YELLOW" "$RESET" "$*"; SKIP=$((SKIP+1)); }

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${REAL_AUDIO_FIXTURES_FILE:-$ROOT_DIR/qa/fixtures/audio-real-urls.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

REAL_AUDIO_CASE_XIAOYUZHOU_URL="${REAL_AUDIO_CASE_XIAOYUZHOU_URL:-https://www.xiaoyuzhoufm.com/episode/69a6dc8ba374f44ffa797457?s=eyJ1IjogIjY1NzViNjJiZWRjZTY3MTA0YWVkN2M2ZSJ9}"
REAL_AUDIO_CASE_DIRECT_URL="${REAL_AUDIO_CASE_DIRECT_URL:-https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3}"
REAL_AUDIO_CASE_YOUTUBE_URL="${REAL_AUDIO_CASE_YOUTUBE_URL:-}"

HUB_URL="${HUB_ENGINE_URL:-http://127.0.0.1:3001}"
AUDIO_URL="${AUDIO_SERVICE_URL:-http://127.0.0.1:8000}"
POLL_ROUNDS="${REAL_AUDIO_POLL_ROUNDS:-40}"
POLL_SLEEP="${REAL_AUDIO_POLL_SLEEP:-5}"
MIN_AUDIO_BYTES="${REAL_AUDIO_MIN_AUDIO_BYTES:-1048576}"

register_user() {
  local ts email username password resp token
  ts="$(date +%s)"
  email="qa_real_audio_${ts}@example.com"
  username="qarealaudio${ts}"
  password="Passw0rd!${ts}"
  resp="$(curl -sS -X POST "$HUB_URL/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"username\":\"${username}\",\"password\":\"${password}\"}" 2>/dev/null || echo '{}')"
  token="$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo '')"
  if [ -z "$token" ]; then
    fail "注册烟测用户失败：$resp"
    exit 1
  fi
  echo "$token"
}

extract_json_field() {
  local payload="$1" field="$2"
  JSON_PAYLOAD="$payload" python3 -c '
import json, os, sys
field = sys.argv[1]
payload = os.environ.get("JSON_PAYLOAD", "")
try:
    data = json.loads(payload)
except Exception:
    print("")
    raise SystemExit(0)
value = data.get(field, "")
if value is None:
    value = ""
print(value)
' "$field"
}

check_case() {
  local name="$1" url="$2" token="$3"
  local create detail task_id status stage file_size failure_code failure_detail source_kind download_strategy
  local resolved_download=0

  if [ -z "$url" ]; then
    skip "$name 未配置，跳过"
    return
  fi

  log "[$name] 创建真实平台任务"
  create="$(curl -sS -X POST "$AUDIO_URL/api/tasks/from-url" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "{\"url\":\"${url}\",\"title\":\"QA Real Audio - ${name}\"}" 2>/dev/null || echo '{}')"

  task_id="$(extract_json_field "$create" id)"
  status="$(extract_json_field "$create" status)"
  stage="$(extract_json_field "$create" download_stage)"

  if [ -z "$task_id" ]; then
    fail "[$name] 未返回 task_id：$create"
    return
  fi

  if [ "$status" = "uploading" ] && [ "$stage" = "queued" ]; then
    pass "[$name] from-url 立即建任务成功 ($task_id)"
  else
    fail "[$name] 创建响应异常：status=$status stage=$stage"
  fi

  for i in $(seq 1 "$POLL_ROUNDS"); do
    sleep "$POLL_SLEEP"
    detail="$(curl -sS "$AUDIO_URL/api/tasks/$task_id" \
      -H "Authorization: Bearer $token" 2>/dev/null || echo '{}')"

    status="$(extract_json_field "$detail" status)"
    stage="$(extract_json_field "$detail" download_stage)"
    file_size="$(extract_json_field "$detail" audio_file_size)"
    failure_code="$(extract_json_field "$detail" failure_code)"
    failure_detail="$(extract_json_field "$detail" failure_detail)"
    source_kind="$(extract_json_field "$detail" source_kind)"
    download_strategy="$(extract_json_field "$detail" download_strategy)"

    log "[$name] 轮询 #$i: status=$status stage=$stage size=${file_size:-0} strategy=${download_strategy:-'-'}"

    if [ "$stage" = "finished" ] || { [ -n "$file_size" ] && [ "$file_size" != "0" ] && [ "$file_size" -ge "$MIN_AUDIO_BYTES" ]; }; then
      resolved_download=1
    fi

    if [ "$resolved_download" -eq 1 ] && printf '%s' "$status" | grep -qiE 'transcribing|summarizing|generating'; then
      break
    fi

    if [ "$status" = "done" ] || [ "$status" = "failed" ]; then
      break
    fi
  done

  if [ "$resolved_download" -eq 1 ]; then
    pass "[$name] 解析/下载/预处理完成（kind=${source_kind:-unknown}, strategy=${download_strategy:-unknown}）"
  else
    fail "[$name] 未观察到有效下载完成信号"
    return
  fi

  if [ "$status" = "done" ]; then
    pass "[$name] 全链路完成"
    return
  fi

  if [ "$resolved_download" -eq 1 ] && printf '%s' "$status" | grep -qiE 'transcribing|summarizing|generating'; then
    pass "[$name] 已进入 AI 处理阶段（status=${status}）"
    return
  fi

  if [ "$status" = "failed" ] && printf '%s %s' "$failure_detail" "$failure_code" | grep -qiE 'ASR|凭证|TINGWU|DASHSCOPE'; then
    pass "[$name] 下载链路成功，失败点已收敛为 ASR 环境未配置"
    return
  fi

  if [ "$status" = "failed" ]; then
    fail "[$name] 失败点仍在下载前半段或未明示：code=${failure_code:-'-'} detail=${failure_detail:-'-'}"
    return
  fi

  fail "[$name] 轮询结束但未进入终态：status=${status:-'-'} stage=${stage:-'-'}"
}

log "============================================"
log "真实平台音频 URL 烟测开始"
log "Hub: $HUB_URL"
log "Audio: $AUDIO_URL"
log "Fixtures: $ENV_FILE"
log "============================================"
echo ""

TOKEN="$(register_user)"
pass "烟测用户注册成功"

check_case "小宇宙页面" "${REAL_AUDIO_CASE_XIAOYUZHOU_URL:-}" "$TOKEN"
check_case "公网直链音频" "${REAL_AUDIO_CASE_DIRECT_URL:-}" "$TOKEN"
check_case "YouTube 页面(可选)" "${REAL_AUDIO_CASE_YOUTUBE_URL:-}" "$TOKEN"

echo ""
TOTAL=$((PASS + FAIL + SKIP))
log "============================================"
log "真实平台音频 URL 烟测完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL  跳过: $SKIP"
log "============================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

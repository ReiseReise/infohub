#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — P0 音频链接异步生命周期回归
# 用法：bash qa/p0/test_audio_url_async_lifecycle.sh
# 目标：验证 from-url 立即建任务 + 后台执行 + 失败阶段可观测
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; RESET='\033[0m'
PASS=0; FAIL=0

log()  { printf "%b[QA]%b %s\n" "$CYAN" "$RESET" "$*"; }
pass() { printf "%b[PASS]%b %s\n" "$GREEN" "$RESET" "$*"; PASS=$((PASS+1)); }
fail() { printf "%b[FAIL]%b %s\n" "$RED" "$RESET" "$*"; FAIL=$((FAIL+1)); }

HUB_URL="${HUB_ENGINE_URL:-http://127.0.0.1:3001}"
AUDIO_URL="${AUDIO_SERVICE_URL:-http://127.0.0.1:8000}"
FIXTURE_PORT="${AUDIO_FIXTURE_PORT:-18081}"
TMP_DIR="$(mktemp -d)"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

log "============================================"
log "P0 音频链接异步生命周期回归开始"
log "Hub: $HUB_URL"
log "Audio: $AUDIO_URL"
log "============================================"
echo ""

cat > "$TMP_DIR/not-audio.html" <<'HTML'
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>QA 非音频页面</title></head>
  <body>
    <h1>QA 非音频页面</h1>
    <p>该页面用于验证 from-url 的异步失败路径是否可观测。</p>
  </body>
</html>
HTML

python3 -m http.server "$FIXTURE_PORT" --directory "$TMP_DIR" >/tmp/infohub-audio-fixture.log 2>&1 &
SERVER_PID=$!
sleep 1

TS="$(date +%s)"
REG=$(curl -sS -X POST "$HUB_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"qa_audio_fix_${TS}@example.com\",\"username\":\"qaaudiofix${TS}\",\"password\":\"Passw0rd!${TS}\"}" 2>/dev/null || echo '{}')
TOKEN=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo "")
if [ -n "$TOKEN" ]; then
  pass "T1: Hub 侧注册并获取 token 成功"
else
  fail "T1: Hub 侧注册失败 ($REG)"
  exit 1
fi

TARGET_URL="http://host.docker.internal:${FIXTURE_PORT}/not-audio.html"
CREATE=$(curl -sS -X POST "$AUDIO_URL/api/tasks/from-url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"${TARGET_URL}\",\"title\":\"QA URL Async Lifecycle\"}" 2>/dev/null || echo '{}')

TASK_ID=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
CREATE_STATUS=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
CREATE_STAGE=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('download_stage',''))" 2>/dev/null || echo "")

if [ -n "$TASK_ID" ] && [ "$TASK_ID" != "None" ]; then
  pass "T2: from-url 立即创建任务成功 (task_id=$TASK_ID)"
else
  fail "T2: from-url 未返回任务 ID ($CREATE)"
  exit 1
fi

if [ "$CREATE_STATUS" = "uploading" ] && [ "$CREATE_STAGE" = "queued" ]; then
  pass "T3: 创建响应状态正确 (uploading + queued)"
else
  fail "T3: 创建响应状态异常 (status=$CREATE_STATUS, stage=$CREATE_STAGE)"
fi

FINAL_STATUS=""
FINAL_STAGE=""
FINAL_CODE=""
for i in $(seq 1 12); do
  sleep 2
  DETAIL=$(curl -sS "$AUDIO_URL/api/tasks/$TASK_ID" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{}')
  STATUS=$(echo "$DETAIL" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
  STAGE=$(echo "$DETAIL" | python3 -c "import sys,json; print(json.load(sys.stdin).get('download_stage',''))" 2>/dev/null || echo "")
  CODE=$(echo "$DETAIL" | python3 -c "import sys,json; print(json.load(sys.stdin).get('failure_code',''))" 2>/dev/null || echo "")

  log "轮询 #$i: status=$STATUS stage=$STAGE code=$CODE"

  FINAL_STATUS="$STATUS"
  FINAL_STAGE="$STAGE"
  FINAL_CODE="$CODE"
  if [ "$STATUS" = "failed" ] || [ "$STATUS" = "done" ]; then
    break
  fi
done

if [ "$FINAL_STATUS" = "failed" ]; then
  pass "T4: 后台任务进入失败终态（符合非音频链接预期）"
else
  fail "T4: 后台任务未进入预期终态 (status=$FINAL_STATUS)"
fi

if [ "$FINAL_STAGE" = "failed" ]; then
  pass "T5: download_stage 正确回写为 failed"
else
  fail "T5: download_stage 未正确回写 (stage=$FINAL_STAGE)"
fi

if [ -n "$FINAL_CODE" ] && [ "$FINAL_CODE" != "None" ]; then
  pass "T6: failure_code 已回写（可观测排障）"
else
  fail "T6: failure_code 缺失"
fi

echo ""
TOTAL=$((PASS + FAIL))
log "============================================"
log "P0 音频链接异步生命周期回归完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL"
log "============================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

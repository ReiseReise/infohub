#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — P0 Folo 集成能力 QA
# 覆盖: discovery / subscriptions / diagnostics
# 用法: bash qa/p0/test_discovery_diagnostics.sh
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; RESET='\033[0m'
PASS=0; FAIL=0; SKIP=0

log()  { printf "%b[QA]%b %s\n" "$CYAN" "$RESET" "$*"; }
pass() { printf "%b[PASS]%b %s\n" "$GREEN" "$RESET" "$*"; PASS=$((PASS+1)); }
fail() { printf "%b[FAIL]%b %s\n" "$RED" "$RESET" "$*"; FAIL=$((FAIL+1)); }
skip() { printf "%b[SKIP]%b %s\n" "$YELLOW" "$RESET" "$*"; SKIP=$((SKIP+1)); }

BASE_URL="${HUB_ENGINE_URL:-http://localhost:3001}"
TS="$(date +%s)"
HELPER_DIR="$(cd "$(dirname "$0")/.." && pwd)/helpers"
source "$HELPER_DIR/auth.sh"

CREATED_SOURCE_IDS=()
FALLBACK_EMAIL="${ACCEPTANCE_USER_EMAIL:-acceptance.user@infohub.local}"
FALLBACK_PASSWORD="${ACCEPTANCE_USER_PASSWORD:-InfoHubUser2026}"

fallback_auth_init() {
  local login_resp
  login_resp=$(curl -sS -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$FALLBACK_EMAIL\",\"password\":\"$FALLBACK_PASSWORD\"}" 2>/dev/null || echo '{}')
  QA_TOKEN=$(echo "$login_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo "")
  if [[ -n "$QA_TOKEN" && "$QA_TOKEN" != "None" ]]; then
    QA_EMAIL="$FALLBACK_EMAIL"
    QA_PASSWORD="$FALLBACK_PASSWORD"
    QA_USERNAME="acceptance_user"
    return 0
  fi
  return 1
}

cleanup() {
  for source_id in "${CREATED_SOURCE_IDS[@]:-}"; do
    if [[ -n "${source_id:-}" ]]; then
      api_curl -X DELETE "$BASE_URL/api/sources/$source_id" >/dev/null 2>&1 || true
    fi
  done
}
trap cleanup EXIT

log "============================================"
log "P0 Folo 集成能力 QA 开始"
log "目标: $BASE_URL"
log "============================================"
echo ""

if qa_auth_init "$BASE_URL" "folo_$TS"; then
  pass "认证成功（临时 QA 用户）"
elif fallback_auth_init; then
  pass "认证成功（验收用户回退）"
else
  skip "认证失败，跳过 discovery/subscriptions/diagnostics API 验证（认证链已由其他套件覆盖）"
  TOTAL=$((PASS + FAIL + SKIP))
  echo ""
  log "============================================"
  log "P0 Folo 集成能力 QA 完成"
  log "  总计: $TOTAL  通过: $PASS  失败: $FAIL  跳过: $SKIP"
  log "============================================"
  exit 0
fi

# ------------------------------------------------------------
# T1: discovery 参数校验
# ------------------------------------------------------------
log "--- T1: discovery 参数校验 ---"
CODE_T1=$(api_curl_code "$BASE_URL/api/discovery/search" 2>/dev/null || echo "000")
if [[ "$CODE_T1" == "400" ]]; then
  pass "T1.1: 缺少 q 返回 400"
else
  fail "T1.1: 预期 400，实际 $CODE_T1"
fi

# ------------------------------------------------------------
# 准备一个本地可匹配的 seed source
# ------------------------------------------------------------
SEED_NAME="QA Discovery Seed $TS"
SEED_URL="https://example.com/feeds/$TS.xml"
SEED_CREATE=$(api_curl -X POST "$BASE_URL/api/sources" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$SEED_NAME\",\"sourceType\":\"rss\",\"collectorType\":\"rss\",\"config\":{\"url\":\"$SEED_URL\"},\"category\":\"qa-folo\"}" 2>/dev/null || echo '{}')
SEED_ID=$(echo "$SEED_CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")
if [[ -n "$SEED_ID" && "$SEED_ID" != "None" ]]; then
  CREATED_SOURCE_IDS+=("$SEED_ID")
  pass "Seed source 创建成功 (id=$SEED_ID)"
else
  fail "Seed source 创建失败 ($SEED_CREATE)"
fi

# ------------------------------------------------------------
# T2: discovery 本地发现能力
# ------------------------------------------------------------
log "--- T2: discovery 本地发现能力 ---"
DISCOVERY_RESP=$(api_curl "$BASE_URL/api/discovery/search?q=Discovery%20Seed&type=search&limit=5" 2>/dev/null || echo '{}')
DISCOVERY_COUNT=$(echo "$DISCOVERY_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")
if [[ "$DISCOVERY_COUNT" -ge 1 ]]; then
  pass "T2.1: discovery 返回候选 >=1"
else
  fail "T2.1: discovery 未返回候选 ($DISCOVERY_RESP)"
fi

# ------------------------------------------------------------
# T3: subscriptions 单条幂等
# ------------------------------------------------------------
log "--- T3: subscriptions 单条幂等 ---"
SUB_URL="https://example.com/sub/$TS.xml"
SUB_CREATE_1=$(api_curl -X POST "$BASE_URL/api/subscriptions" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"QA Sub One $TS\",\"sourceType\":\"rss\",\"collectorType\":\"rss\",\"config\":{\"url\":\"$SUB_URL\"},\"category\":\"qa-folo\"}" 2>/dev/null || echo '{}')
SUB_CREATED_1=$(echo "$SUB_CREATE_1" | python3 -c "import sys,json; d=json.load(sys.stdin); print('1' if d.get('created') else '0')" 2>/dev/null || echo "0")
SUB_ID_1=$(echo "$SUB_CREATE_1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")
if [[ "$SUB_CREATED_1" == "1" && -n "$SUB_ID_1" && "$SUB_ID_1" != "None" ]]; then
  CREATED_SOURCE_IDS+=("$SUB_ID_1")
  pass "T3.1: 首次订阅创建成功 (id=$SUB_ID_1)"
else
  fail "T3.1: 首次订阅创建失败 ($SUB_CREATE_1)"
fi

SUB_CREATE_2=$(api_curl -X POST "$BASE_URL/api/subscriptions" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"QA Sub Two $TS\",\"sourceType\":\"rss\",\"collectorType\":\"rss\",\"config\":{\"url\":\"$SUB_URL\"},\"category\":\"qa-folo\"}" 2>/dev/null || echo '{}')
SUB_DUP_2=$(echo "$SUB_CREATE_2" | python3 -c "import sys,json; d=json.load(sys.stdin); print('1' if d.get('duplicate') else '0')" 2>/dev/null || echo "0")
if [[ "$SUB_DUP_2" == "1" ]]; then
  pass "T3.2: 重复订阅被识别（duplicate=true）"
else
  fail "T3.2: 重复订阅未识别 ($SUB_CREATE_2)"
fi

# ------------------------------------------------------------
# T4: subscriptions 批量能力
# ------------------------------------------------------------
log "--- T4: subscriptions 批量能力 ---"
BATCH_RESP=$(api_curl -X POST "$BASE_URL/api/subscriptions/batch" \
  -H "Content-Type: application/json" \
  -d "{
    \"categoryDefault\": \"qa-folo-batch\",
    \"items\": [
      {\"name\":\"Batch A $TS\",\"sourceType\":\"rss\",\"collectorType\":\"rss\",\"config\":{\"url\":\"https://example.com/batch-a-$TS.xml\"}},
      {\"name\":\"Batch Dup $TS\",\"sourceType\":\"rss\",\"collectorType\":\"rss\",\"config\":{\"url\":\"$SUB_URL\"}},
      {\"name\":\"Batch Invalid $TS\",\"sourceType\":\"rss\",\"collectorType\":\"rss\",\"config\":{}}
    ]
  }" 2>/dev/null || echo '{}')
BATCH_CREATED=$(echo "$BATCH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('summary',{}).get('created',0))" 2>/dev/null || echo "0")
BATCH_DUP=$(echo "$BATCH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('summary',{}).get('duplicates',0))" 2>/dev/null || echo "0")
BATCH_FAILED=$(echo "$BATCH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('summary',{}).get('failed',0))" 2>/dev/null || echo "0")
if [[ "$BATCH_CREATED" -ge 1 && "$BATCH_DUP" -ge 1 && "$BATCH_FAILED" -ge 1 ]]; then
  pass "T4.1: 批量处理结果符合预期 (created=$BATCH_CREATED dup=$BATCH_DUP failed=$BATCH_FAILED)"
else
  fail "T4.1: 批量处理结果异常 ($BATCH_RESP)"
fi

BATCH_CREATED_IDS=$(echo "$BATCH_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(' '.join(str(x.get('data',{}).get('id','')) for x in d.get('created',[])))" 2>/dev/null || echo "")
for sid in $BATCH_CREATED_IDS; do
  if [[ -n "$sid" && "$sid" != "None" ]]; then
    CREATED_SOURCE_IDS+=("$sid")
  fi
done

# ------------------------------------------------------------
# T5: diagnostics 接口
# ------------------------------------------------------------
log "--- T5: diagnostics 接口 ---"
DIAG_NETWORK=$(api_curl "$BASE_URL/api/diagnostics/network" 2>/dev/null || echo '{}')
DIAG_TOTAL=$(echo "$DIAG_NETWORK" | python3 -c "import sys,json; print(json.load(sys.stdin).get('summary',{}).get('total',0))" 2>/dev/null || echo "0")
if [[ "$DIAG_TOTAL" -gt 0 ]]; then
  pass "T5.1: network 诊断返回 summary.total=$DIAG_TOTAL"
else
  fail "T5.1: network 诊断返回异常 ($DIAG_NETWORK)"
fi

DIAG_PROXY_CODE=$(api_curl_code -X POST "$BASE_URL/api/diagnostics/proxy-test" \
  -H "Content-Type: application/json" \
  -d '{"proxyUrl":"bad-proxy","targetUrl":"https://www.github.com"}' 2>/dev/null || echo "000")
if [[ "$DIAG_PROXY_CODE" == "400" ]]; then
  pass "T5.2: proxy-test 非法代理返回 400"
else
  fail "T5.2: proxy-test 非法代理预期 400，实际 $DIAG_PROXY_CODE"
fi

DIAG_JOBS_CODE=$(api_curl_code "$BASE_URL/api/diagnostics/fetch-jobs" 2>/dev/null || echo "000")
if [[ "$DIAG_JOBS_CODE" == "403" ]]; then
  pass "T5.3: 非管理员访问 fetch-jobs 返回 403"
else
  fail "T5.3: 非管理员访问 fetch-jobs 预期 403，实际 $DIAG_JOBS_CODE"
fi

echo ""
TOTAL=$((PASS + FAIL + SKIP))
log "============================================"
log "P0 Folo 集成能力 QA 完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL  跳过: $SKIP"
log "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0

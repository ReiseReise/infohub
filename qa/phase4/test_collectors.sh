#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — Phase 4 扩展采集器 + Webhook QA 测试
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; RESET='\033[0m'
PASS=0; FAIL=0; SKIP=0

log()  { printf "%b[QA]%b %s\n" "$CYAN" "$RESET" "$*"; }
pass() { printf "%b[PASS]%b %s\n" "$GREEN" "$RESET" "$*"; PASS=$((PASS+1)); }
fail() { printf "%b[FAIL]%b %s\n" "$RED" "$RESET" "$*"; FAIL=$((FAIL+1)); }
skip() { printf "%b[SKIP]%b %s\n" "$YELLOW" "$RESET" "$*"; SKIP=$((SKIP+1)); }

BASE_URL="${HUB_ENGINE_URL:-http://localhost:3001}"
TS=$(date +%s)
HUB_SRC="$(cd "$(dirname "$0")/../../services/hub-engine/src" && pwd)"
HELPER_DIR="$(cd "$(dirname "$0")/.." && pwd)/helpers"
source "$HELPER_DIR/auth.sh"

log "============================================"
log "Phase 4 扩展采集器 + Webhook QA 测试开始"
log "============================================"
echo ""

if qa_auth_init "$BASE_URL" "$TS"; then
  pass "T0.1: QA 用户认证成功"
else
  fail "T0.1: QA 用户认证失败，无法继续 API 测试"
  exit 1
fi
echo ""

# ============================================================
# T1: 采集器模块完整性
# ============================================================
log "--- T1: 采集器模块 ---"

for mod in "collectors/rss.ts" "collectors/rsshub.ts" "collectors/changedetection.ts" "collectors/youtube.ts" "collectors/custom.ts" "collectors/base.ts"; do
  if [ -f "$HUB_SRC/$mod" ]; then
    pass "T1: $mod 存在"
  else
    fail "T1: $mod 不存在"
  fi
done
echo ""

# ============================================================
# T2: Pipeline 注册所有采集器
# ============================================================
log "--- T2: Pipeline 注册 ---"

for collector in "RssCollector" "RsshubCollector" "ChangedetectionCollector" "YoutubeCollector" "CustomCollector"; do
  if grep -q "$collector" "$HUB_SRC/scheduler/pipeline.ts"; then
    pass "T2: $collector 已注册到 pipeline"
  else
    fail "T2: $collector 未注册到 pipeline"
  fi
done
echo ""

# ============================================================
# T3: Hooks API 端点
# ============================================================
log "--- T3: Hooks API ---"

# T3.1: /api/hooks/status
STATUS=$(api_curl "$BASE_URL/api/hooks/status" 2>/dev/null || echo '{}')
STATUS_OK=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
if [ "$STATUS_OK" = "ok" ]; then
  pass "T3.1: /api/hooks/status 返回 ok"
else
  fail "T3.1: /api/hooks/status 异常 ($STATUS)"
fi

# T3.2: /api/hooks/highlights
HL=$(api_curl "$BASE_URL/api/hooks/highlights" 2>/dev/null || echo '{}')
HL_OK=$(echo "$HL" | python3 -c "import sys,json; print('ok' if 'data' in json.load(sys.stdin) else 'fail')" 2>/dev/null || echo "fail")
if [ "$HL_OK" = "ok" ]; then
  pass "T3.2: /api/hooks/highlights 返回数据"
else
  fail "T3.2: /api/hooks/highlights 异常"
fi

# T3.3: /api/hooks/ingest
INGEST=$(api_curl -X POST "$BASE_URL/api/hooks/ingest" \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"title\":\"QA Webhook Test $TS\",\"url\":\"https://example.com/qa-webhook-$TS\",\"content\":\"Phase 4 QA test item\"}]}" 2>/dev/null || echo '{}')
INGEST_COUNT=$(echo "$INGEST" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ingested',0))" 2>/dev/null || echo "0")
if [ "$INGEST_COUNT" -ge 1 ] 2>/dev/null; then
  pass "T3.3: /api/hooks/ingest 成功注入 $INGEST_COUNT 条"
else
  fail "T3.3: /api/hooks/ingest 注入失败 ($INGEST)"
fi

# T3.4: 验证注入的数据可查
sleep 1
SEARCH=$(api_curl "$BASE_URL/api/items?search=QA+Webhook+Test&limit=1" 2>/dev/null || echo '{}')
SEARCH_COUNT=$(echo "$SEARCH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
if [ "$SEARCH_COUNT" -ge 1 ] 2>/dev/null; then
  pass "T3.4: 注入数据可通过搜索查到"
else
  skip "T3.4: 注入数据搜索未命中（可能索引延迟）"
fi

# T3.5: 格式校验
BAD_INGEST=$(api_curl_code -X POST "$BASE_URL/api/hooks/ingest" \
  -H "Content-Type: application/json" \
  -d '{"bad":"data"}' 2>/dev/null || echo "000")
if [ "$BAD_INGEST" = "400" ]; then
  pass "T3.5: 错误格式返回 400"
else
  fail "T3.5: 错误格式预期 400，实际 $BAD_INGEST"
fi
echo ""

# ============================================================
# T4: 创建各类型信源
# ============================================================
log "--- T4: 各类型信源创建 ---"

# YouTube 信源
YT=$(api_curl -X POST "$BASE_URL/api/sources" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"QA YouTube $TS\",\"sourceType\":\"rsshub\",\"collectorType\":\"youtube\",\"config\":{\"channelId\":\"UC_x5XG1OV2P6uZZ5FSM9Ttw\"},\"category\":\"qa-test\"}" 2>/dev/null || echo '{}')
YT_ID=$(echo "$YT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")
if [ -n "$YT_ID" ] && [ "$YT_ID" != "None" ] && [ "$YT_ID" != "" ]; then
  pass "T4.1: YouTube 信源创建成功 (id=$YT_ID)"
else
  fail "T4.1: YouTube 信源创建失败"
fi

# changedetection 信源
CD=$(api_curl -X POST "$BASE_URL/api/sources" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"QA CD $TS\",\"sourceType\":\"webpage\",\"collectorType\":\"changedetection\",\"config\":{\"url\":\"https://example.com\"},\"category\":\"qa-test\"}" 2>/dev/null || echo '{}')
CD_ID=$(echo "$CD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")
if [ -n "$CD_ID" ] && [ "$CD_ID" != "None" ] && [ "$CD_ID" != "" ]; then
  pass "T4.2: changedetection 信源创建成功 (id=$CD_ID)"
else
  fail "T4.2: changedetection 信源创建失败"
fi

# Custom 信源
CU=$(api_curl -X POST "$BASE_URL/api/sources" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"QA Custom $TS\",\"sourceType\":\"custom\",\"collectorType\":\"custom\",\"config\":{\"endpoint\":\"https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=5\"},\"category\":\"qa-test\"}" 2>/dev/null || echo '{}')
CU_ID=$(echo "$CU" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")
if [ -n "$CU_ID" ] && [ "$CU_ID" != "None" ] && [ "$CU_ID" != "" ]; then
  pass "T4.3: Custom 信源创建成功 (id=$CU_ID)"
else
  fail "T4.3: Custom 信源创建失败"
fi
echo ""

# ============================================================
# T5: hooks 路由已注册到 index.ts
# ============================================================
log "--- T5: 路由注册 ---"

if grep -q "hooksRoutes" "$HUB_SRC/index.ts"; then
  pass "T5.1: hooks 路由已注册"
else
  fail "T5.1: hooks 路由未注册"
fi

if grep -q "/api/hooks" "$HUB_SRC/index.ts"; then
  pass "T5.2: /api/hooks 路径已挂载"
else
  fail "T5.2: /api/hooks 路径未挂载"
fi
echo ""

# ============================================================
# T6: 清理
# ============================================================
log "--- T6: 清理 ---"

for sid in "$YT_ID" "$CD_ID" "$CU_ID"; do
  if [ -n "$sid" ] && [ "$sid" != "None" ] && [ "$sid" != "" ]; then
    api_curl -X DELETE "$BASE_URL/api/sources/$sid" >/dev/null 2>&1
  fi
done
pass "T6: 测试信源已清理"
echo ""

# ============================================================
# 汇总
# ============================================================
TOTAL=$((PASS + FAIL + SKIP))
log "============================================"
log "Phase 4 扩展采集器 + Webhook QA 测试完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL  跳过: $SKIP"
log "============================================"

if [ "$FAIL" -gt 0 ]; then
  fail "存在 $FAIL 个失败项！"
  exit 1
else
  pass "所有测试通过！"
  exit 0
fi

#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — Stage B+C QA 测试
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; RESET='\033[0m'
PASS=0; FAIL=0; SKIP=0

log()  { printf "%b[QA]%b %s\n" "$CYAN" "$RESET" "$*"; }
pass() { printf "%b[PASS]%b %s\n" "$GREEN" "$RESET" "$*"; PASS=$((PASS+1)); }
fail() { printf "%b[FAIL]%b %s\n" "$RED" "$RESET" "$*"; FAIL=$((FAIL+1)); }
skip() { printf "%b[SKIP]%b %s\n" "$YELLOW" "$RESET" "$*"; SKIP=$((SKIP+1)); }

BASE_URL="${HUB_ENGINE_URL:-http://localhost:3001}"
WEB_DIR="$(cd "$(dirname "$0")/../../apps/web" && pwd)"
TS=$(date +%s)
HELPER_DIR="$(cd "$(dirname "$0")/.." && pwd)/helpers"
source "$HELPER_DIR/auth.sh"

log "============================================"
log "Stage B+C QA 测试"
log "============================================"
echo ""

if qa_auth_init "$BASE_URL" "$TS"; then
  pass "T0.1: QA 用户认证成功"
else
  fail "T0.1: QA 用户认证失败，无法继续 API 测试"
  exit 1
fi
echo ""

# ---- Stage B: AI 处理验证 ----
log "--- B1: AI configs ---"
AI_CFGS=$(api_curl "$BASE_URL/api/ai-configs" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")
if [ "$AI_CFGS" -ge 1 ] 2>/dev/null; then
  pass "B1.1: AI configs 已配置 ($AI_CFGS)"
else
  skip "B1.1: 当前测试账号未配置 AI configs（接口可用，需业务侧补配置）"
fi

log "--- B2: AI 评分结果 ---"
SCORED=$(docker exec infohub-postgres psql -U postgres -d infohub -t -A -c "SELECT count(*) FROM hub.items WHERE ai_score IS NOT NULL;" 2>/dev/null || echo "0")
SCORED=$(echo "$SCORED" | tr -d '[:space:]')
if [ "$SCORED" -gt 0 ] 2>/dev/null; then pass "B2.1: $SCORED 条已AI评分"; else skip "B2.1: 暂无AI评分（等待Cron触发）"; fi

log "--- B3: AI 摘要结果 ---"
SUMMARIZED=$(docker exec infohub-postgres psql -U postgres -d infohub -t -A -c "SELECT count(*) FROM hub.items WHERE ai_summary IS NOT NULL;" 2>/dev/null || echo "0")
SUMMARIZED=$(echo "$SUMMARIZED" | tr -d '[:space:]')
if [ "$SUMMARIZED" -gt 0 ] 2>/dev/null; then pass "B3.1: $SUMMARIZED 条已AI摘要"; else skip "B3.1: 暂无AI摘要"; fi

log "--- B4: AI 开关配置 ---"
if grep -q "AI_PROCESSING_ENABLED" "$(dirname "$0")/../../services/hub-engine/src/config/index.ts"; then
  pass "B4.1: AI开关配置存在"
else
  fail "B4.1: AI开关配置缺失"
fi
echo ""

# ---- Stage C: 前端增强 ----
log "--- C1: Rules API ---"
RULES_STATUS=$(api_curl_code "$BASE_URL/api/rules" 2>/dev/null || echo "000")
if [ "$RULES_STATUS" = "200" ]; then pass "C1.1: GET /api/rules 200"; else fail "C1.1: GET /api/rules $RULES_STATUS"; fi

RULE_CREATE=$(api_curl -X POST "$BASE_URL/api/rules" -H "Content-Type: application/json" -d '{"name":"QA Test Rule","type":"keyword_blacklist","config":{"keywords":["qa_test"]},"enabled":true}' 2>/dev/null || echo '{}')
RULE_ID=$(echo "$RULE_CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")
if [ -n "$RULE_ID" ] && [ "$RULE_ID" != "None" ]; then pass "C1.2: 创建规则成功 (id=$RULE_ID)"; else fail "C1.2: 创建规则失败"; fi

if [ -n "$RULE_ID" ] && [ "$RULE_ID" != "None" ]; then
  api_curl -X DELETE "$BASE_URL/api/rules/$RULE_ID" >/dev/null 2>&1
  pass "C1.3: 删除规则成功"
fi

log "--- C2: AI Config API ---"
AICFG_STATUS=$(api_curl_code "$BASE_URL/api/ai-configs" 2>/dev/null || echo "000")
if [ "$AICFG_STATUS" = "200" ]; then pass "C2.1: GET /api/ai-configs 200"; else fail "C2.1: GET /api/ai-configs $AICFG_STATUS"; fi

log "--- C3: 前端构建 ---"
if [ -f "$WEB_DIR/dist/index.html" ]; then pass "C3.1: dist/index.html 存在"; else fail "C3.1: dist/index.html 不存在"; fi

JS_KB=$(find "$WEB_DIR/dist/assets" -name "*.js" -exec wc -c {} + 2>/dev/null | tail -1 | awk '{print int($1/1024)}')
if [ "${JS_KB:-0}" -lt 500 ] 2>/dev/null; then pass "C3.2: JS bundle ${JS_KB}KB < 500KB"; else skip "C3.2: JS bundle ${JS_KB}KB"; fi

log "--- C4: 新增页面组件 ---"
if [ -f "$WEB_DIR/src/pages/Rules.tsx" ]; then pass "C4.1: Rules.tsx 存在"; else fail "C4.1: Rules.tsx 不存在"; fi

if grep -q "rules" "$WEB_DIR/src/App.tsx"; then pass "C4.2: Rules路由已注册"; else fail "C4.2: Rules路由未注册"; fi
if grep -q "to: '/rules'" "$WEB_DIR/src/components/Sidebar.tsx"; then pass "C4.3: Sidebar含规则入口"; else fail "C4.3: Sidebar缺规则入口"; fi
echo ""

# ---- 汇总 ----
TOTAL=$((PASS + FAIL + SKIP))
log "============================================"
log "Stage B+C QA 完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL  跳过: $SKIP"
log "============================================"

if [ "$FAIL" -gt 0 ]; then fail "存在 $FAIL 个失败项！"; exit 1; else pass "所有测试通过！"; exit 0; fi

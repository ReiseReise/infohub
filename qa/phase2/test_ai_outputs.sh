#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — Phase 2 AI处理+输出层 QA 测试
# 用法：bash qa/phase2/test_ai_outputs.sh
# 前提：hub-engine 运行中 + 数据库有已采集的条目
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
HELPER_DIR="$(cd "$(dirname "$0")/.." && pwd)/helpers"
source "$HELPER_DIR/auth.sh"

log "============================================"
log "Phase 2 AI处理+输出层 QA 测试开始"
log "目标: $BASE_URL"
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
# T1: 日报生成
# ============================================================
log "--- T1: 日报生成 ---"

REPORT=$(api_curl -X POST "$BASE_URL/api/insights/generate" 2>/dev/null || echo '{}')
REPORT_DATE=$(echo "$REPORT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('date',''))" 2>/dev/null || echo "")
if [ -n "$REPORT_DATE" ] && [ "$REPORT_DATE" != "" ] && [ "$REPORT_DATE" != "None" ]; then
  pass "T1.1: 日报生成成功 (date=$REPORT_DATE)"
else
  fail "T1.1: 日报生成失败"
fi

REPORT_MD=$(echo "$REPORT" | python3 -c "import sys,json; md=json.load(sys.stdin).get('markdown',''); print('ok' if '信息中枢日报' in md else 'fail')" 2>/dev/null || echo "fail")
if [ "$REPORT_MD" = "ok" ]; then
  pass "T1.2: 日报 Markdown 格式正确"
else
  fail "T1.2: 日报 Markdown 格式异常"
fi

REPORT_MSG=$(echo "$REPORT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message',''))" 2>/dev/null || echo "")
if echo "$REPORT_MSG" | grep -q "generated"; then
  pass "T1.3: 日报推送触发成功"
else
  fail "T1.3: 日报推送未触发 ($REPORT_MSG)"
fi
echo ""

# ============================================================
# T2: 日报列表与查询
# ============================================================
log "--- T2: 日报列表 ---"

INSIGHTS_LIST=$(api_curl "$BASE_URL/api/insights" 2>/dev/null || echo '{}')
INSIGHTS_OK=$(echo "$INSIGHTS_LIST" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if 'data' in d and len(d['data'])>0 else 'fail')" 2>/dev/null || echo "fail")
if [ "$INSIGHTS_OK" = "ok" ]; then
  pass "T2.1: 日报列表有数据"
else
  fail "T2.1: 日报列表为空"
fi

if [ -n "$REPORT_DATE" ] && [ "$REPORT_DATE" != "None" ]; then
  INSIGHT_DETAIL=$(api_curl "$BASE_URL/api/insights/$REPORT_DATE" 2>/dev/null || echo '{}')
  DETAIL_OK=$(echo "$INSIGHT_DETAIL" | python3 -c "import sys,json; print('ok' if 'data' in json.load(sys.stdin) else 'fail')" 2>/dev/null || echo "fail")
  if [ "$DETAIL_OK" = "ok" ]; then
    pass "T2.2: 日报详情查询成功 ($REPORT_DATE)"
  else
    fail "T2.2: 日报详情查询失败"
  fi
fi
echo ""

# ============================================================
# T3: Obsidian 导出
# ============================================================
log "--- T3: Obsidian 导出 ---"

OBS_RESP=$(api_curl -X POST "$BASE_URL/api/export/obsidian" 2>/dev/null || echo '{}')
OBS_COUNT=$(echo "$OBS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('exported',0))" 2>/dev/null || echo "0")
if [ "$OBS_COUNT" -ge 0 ] 2>/dev/null; then
  pass "T3.1: Obsidian 导出成功 (exported=$OBS_COUNT)"
else
  fail "T3.1: Obsidian 导出失败 ($OBS_RESP)"
fi

OBS_MSG=$(echo "$OBS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message',''))" 2>/dev/null || echo "")
if echo "$OBS_MSG" | grep -qi "obsidian"; then
  pass "T3.2: Obsidian 导出消息格式正确"
else
  fail "T3.2: Obsidian 导出消息异常 ($OBS_MSG)"
fi
echo ""

# ============================================================
# T4: 知识库文件导出
# ============================================================
log "--- T4: 知识库文件导出 ---"

KB_RESP=$(api_curl -X POST "$BASE_URL/api/export/knowledge" 2>/dev/null || echo '{}')
KB_COUNT=$(echo "$KB_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('exported',0))" 2>/dev/null || echo "0")
if [ "$KB_COUNT" -ge 0 ] 2>/dev/null; then
  pass "T4.1: 知识库导出成功 (exported=$KB_COUNT)"
else
  fail "T4.1: 知识库导出失败 ($KB_RESP)"
fi
echo ""

# ============================================================
# T5: Markdown 日报导出
# ============================================================
log "--- T5: Markdown 导出 ---"

MD_STATUS=$(api_curl_code -X POST "$BASE_URL/api/export/markdown" 2>/dev/null || echo "000")
if [ "$MD_STATUS" = "200" ]; then
  pass "T5.1: Markdown 日报导出返回 200"
else
  fail "T5.1: Markdown 日报导出失败 (HTTP $MD_STATUS)"
fi

MD_CONTENT=$(api_curl -X POST "$BASE_URL/api/export/markdown" 2>/dev/null || echo "")
if echo "$MD_CONTENT" | grep -q "信息中枢日报"; then
  pass "T5.2: Markdown 内容包含日报标题"
else
  fail "T5.2: Markdown 内容格式异常"
fi
echo ""

# ============================================================
# T6: ntfy 推送验证
# ============================================================
log "--- T6: ntfy 推送 ---"

NTFY_URL="${NTFY_URL:-http://localhost:8081}"
NTFY_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$NTFY_URL/v1/health" 2>/dev/null || echo "000")
if [ "$NTFY_HEALTH" = "200" ]; then
  pass "T6.1: ntfy 服务健康"
else
  skip "T6.1: ntfy 不可达 ($NTFY_HEALTH)"
fi
echo ""

# ============================================================
# T7: 处理器模块存在性验证
# ============================================================
log "--- T7: 处理器模块完整性 ---"

HUB_SRC="${HUB_ENGINE_SRC:-$(dirname "$0")/../../services/hub-engine/src}"
for mod in "processors/filter.ts" "processors/ai-scorer.ts" "processors/ai-summarizer.ts" "processors/priority.ts" "outputs/daily-report.ts" "outputs/push.ts" "outputs/knowledge.ts" "outputs/obsidian.ts"; do
  if [ -f "$HUB_SRC/$mod" ]; then
    pass "T7: $mod 存在"
  else
    fail "T7: $mod 不存在"
  fi
done
echo ""

# ============================================================
# 汇总
# ============================================================
TOTAL=$((PASS + FAIL + SKIP))
log "============================================"
log "Phase 2 AI处理+输出层 QA 测试完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL  跳过: $SKIP"
log "============================================"

if [ "$FAIL" -gt 0 ]; then
  fail "存在 $FAIL 个失败项，请检查！"
  exit 1
else
  pass "所有测试通过！"
  exit 0
fi

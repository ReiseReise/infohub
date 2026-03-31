#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — Phase 5 向量化+知识库 QA 测试
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; RESET='\033[0m'
PASS=0; FAIL=0; SKIP=0

log()  { printf "%b[QA]%b %s\n" "$CYAN" "$RESET" "$*"; }
pass() { printf "%b[PASS]%b %s\n" "$GREEN" "$RESET" "$*"; PASS=$((PASS+1)); }
fail() { printf "%b[FAIL]%b %s\n" "$RED" "$RESET" "$*"; FAIL=$((FAIL+1)); }
skip() { printf "%b[SKIP]%b %s\n" "$YELLOW" "$RESET" "$*"; SKIP=$((SKIP+1)); }

BASE_URL="${HUB_ENGINE_URL:-http://localhost:3001}"
HUB_SRC="$(cd "$(dirname "$0")/../../services/hub-engine/src" && pwd)"
TS=$(date +%s)
HELPER_DIR="$(cd "$(dirname "$0")/.." && pwd)/helpers"
source "$HELPER_DIR/auth.sh"

log "============================================"
log "Phase 5 向量化+知识库 QA 测试开始"
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
# T1: 模块完整性
# ============================================================
log "--- T1: 模块完整性 ---"

for mod in "processors/embedder.ts" "routes/knowledge.ts"; do
  if [ -f "$HUB_SRC/$mod" ]; then
    pass "T1: $mod 存在"
  else
    fail "T1: $mod 不存在"
  fi
done

if grep -q "knowledgeRoutes" "$HUB_SRC/index.ts"; then
  pass "T1: knowledge 路由已注册"
else
  fail "T1: knowledge 路由未注册"
fi
echo ""

# ============================================================
# T2: Knowledge Items API
# ============================================================
log "--- T2: Knowledge Items ---"

ITEMS=$(api_curl "$BASE_URL/api/knowledge/items?limit=5" 2>/dev/null || echo '{}')
ITEMS_OK=$(echo "$ITEMS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if 'data' in d and 'count' in d else 'fail')" 2>/dev/null || echo "fail")
if [ "$ITEMS_OK" = "ok" ]; then
  pass "T2.1: /api/knowledge/items 返回正确格式"
else
  fail "T2.1: /api/knowledge/items 格式异常"
fi

ITEMS_COUNT=$(echo "$ITEMS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo "0")
if [ "$ITEMS_COUNT" -gt 0 ] 2>/dev/null; then
  pass "T2.2: 有 $ITEMS_COUNT 条知识条目"
else
  skip "T2.2: 暂无知识条目"
fi

# 增量拉取测试
SINCE_ITEMS=$(api_curl "$BASE_URL/api/knowledge/items?since=2020-01-01T00:00:00Z&limit=3" 2>/dev/null || echo '{}')
SINCE_OK=$(echo "$SINCE_ITEMS" | python3 -c "import sys,json; print('ok' if 'data' in json.load(sys.stdin) else 'fail')" 2>/dev/null || echo "fail")
if [ "$SINCE_OK" = "ok" ]; then
  pass "T2.3: since 增量拉取正常"
else
  fail "T2.3: since 增量拉取异常"
fi
echo ""

# ============================================================
# T3: Knowledge Search API
# ============================================================
log "--- T3: Knowledge Search ---"

# 全文搜索
SEARCH=$(api_curl "$BASE_URL/api/knowledge/search?q=tech&limit=5" 2>/dev/null || echo '{}')
SEARCH_MODE=$(echo "$SEARCH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('mode',''))" 2>/dev/null || echo "")
if [ "$SEARCH_MODE" = "text" ]; then
  pass "T3.1: 全文搜索返回 mode=text"
else
  fail "T3.1: 全文搜索模式异常 ($SEARCH_MODE)"
fi

SEARCH_COUNT=$(echo "$SEARCH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo "0")
if [ "$SEARCH_COUNT" -ge 0 ] 2>/dev/null; then
  pass "T3.2: 搜索返回 $SEARCH_COUNT 条结果"
else
  fail "T3.2: 搜索结果异常"
fi

# 混合搜索
HYBRID=$(api_curl "$BASE_URL/api/knowledge/search?q=AI&mode=hybrid&limit=3" 2>/dev/null || echo '{}')
HYBRID_MODE=$(echo "$HYBRID" | python3 -c "import sys,json; print(json.load(sys.stdin).get('mode',''))" 2>/dev/null || echo "")
if [ "$HYBRID_MODE" = "hybrid" ] || [ "$HYBRID_MODE" = "text_fallback" ]; then
  pass "T3.3: 混合搜索返回 mode=$HYBRID_MODE"
else
  fail "T3.3: 混合搜索模式异常 ($HYBRID_MODE)"
fi

# 无查询参数
NO_Q=$(api_curl_code "$BASE_URL/api/knowledge/search" 2>/dev/null || echo "000")
if [ "$NO_Q" = "400" ]; then
  pass "T3.4: 无查询参数返回 400"
else
  fail "T3.4: 无查询参数预期 400，实际 $NO_Q"
fi
echo ""

# ============================================================
# T4: Knowledge Daily API
# ============================================================
log "--- T4: Knowledge Daily ---"

TODAY=$(date +%Y-%m-%d)
YESTERDAY=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d 2>/dev/null || echo "2026-03-01")

DAILY=$(api_curl "$BASE_URL/api/knowledge/daily/$YESTERDAY" 2>/dev/null || echo '{}')
DAILY_STATUS=$(api_curl_code "$BASE_URL/api/knowledge/daily/$YESTERDAY" 2>/dev/null || echo "000")
if [ "$DAILY_STATUS" = "200" ] || [ "$DAILY_STATUS" = "404" ]; then
  pass "T4.1: /api/knowledge/daily 返回有效状态码 ($DAILY_STATUS)"
else
  fail "T4.1: /api/knowledge/daily 异常 ($DAILY_STATUS)"
fi
echo ""

# ============================================================
# T5: pgvector 扩展验证
# ============================================================
log "--- T5: pgvector ---"

VECTOR_EXT=$(docker exec infohub-postgres psql -U postgres -d infohub -t -A -c "SELECT count(*) FROM pg_extension WHERE extname='vector';" 2>/dev/null || echo "0")
VECTOR_EXT=$(echo "$VECTOR_EXT" | tr -d '[:space:]')
if [ "$VECTOR_EXT" = "1" ]; then
  pass "T5.1: pgvector 扩展已安装"
else
  fail "T5.1: pgvector 扩展未安装"
fi

IDX=$(docker exec infohub-postgres psql -U postgres -d infohub -t -A -c "SELECT count(*) FROM pg_indexes WHERE tablename='items' AND indexname='idx_items_embedding';" 2>/dev/null || echo "0")
IDX=$(echo "$IDX" | tr -d '[:space:]')
if [ "$IDX" = "1" ]; then
  pass "T5.2: HNSW 向量索引存在"
else
  fail "T5.2: HNSW 向量索引不存在"
fi
echo ""

# ============================================================
# 汇总
# ============================================================
TOTAL=$((PASS + FAIL + SKIP))
log "============================================"
log "Phase 5 向量化+知识库 QA 测试完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL  跳过: $SKIP"
log "============================================"

if [ "$FAIL" -gt 0 ]; then
  fail "存在 $FAIL 个失败项！"
  exit 1
else
  pass "所有测试通过！"
  exit 0
fi

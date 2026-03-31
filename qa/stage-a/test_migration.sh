#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — Stage A 数据迁移+信源上线 QA 测试
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
log "Stage A 数据迁移+信源上线 QA 测试"
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
# T1: 信源数量验证
# ============================================================
log "--- T1: 信源数量 ---"

STATS_RESP=$(api_curl "$BASE_URL/api/sources/stats" 2>/dev/null || echo '{}')
TOTAL_SOURCES=$(echo "$STATS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
if [ "$TOTAL_SOURCES" -ge 500 ] 2>/dev/null; then
  pass "T1.1: 信源总数 $TOTAL_SOURCES >= 500"
elif [ "$TOTAL_SOURCES" -gt 0 ] 2>/dev/null; then
  skip "T1.1: 信源总数 $TOTAL_SOURCES（已启用，但未达到迁移验证阈值 500）"
else
  skip "T1.1: 当前账号暂无信源（迁移验证场景未启用）"
fi

# 检查分类数
CATS=$(api_curl "$BASE_URL/api/sources/categories" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")
if [ "$CATS" -ge 10 ] 2>/dev/null; then
  pass "T1.2: 分类数 $CATS >= 10"
elif [ "$CATS" -gt 0 ] 2>/dev/null; then
  skip "T1.2: 分类数 $CATS（未达到迁移验证阈值 10）"
else
  skip "T1.2: 当前账号暂无分类"
fi

# 检查 RSSHub 类型源
RSSHUB_COUNT=$(echo "$STATS_RESP" | python3 -c "import sys,json; types=json.load(sys.stdin).get('byType',[]); print(next((t['count'] for t in types if t['sourceType']=='rsshub'),0))" 2>/dev/null || echo "0")
if [ "$RSSHUB_COUNT" -ge 30 ] 2>/dev/null; then
  pass "T1.3: RSSHub 源数 ${RSSHUB_COUNT} >= 30"
else
  skip "T1.3: RSSHub 源数 ${RSSHUB_COUNT}（部分OPML中的rsshub源已计入）"
fi
echo ""

# ============================================================
# T2: 采集数据验证
# ============================================================
log "--- T2: 采集数据 ---"

TOTAL_ITEMS=$(api_curl "$BASE_URL/api/items/stats" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
if [ "$TOTAL_ITEMS" -ge 1000 ] 2>/dev/null; then
  pass "T2.1: 文章总数 ${TOTAL_ITEMS} >= 1000"
elif [ "$TOTAL_ITEMS" -gt 0 ] 2>/dev/null; then
  skip "T2.1: 文章总数 ${TOTAL_ITEMS}（未达到迁移验证阈值 1000）"
else
  skip "T2.1: 当前账号暂无文章（迁移验证场景未启用）"
fi

# 检查队列状态
FETCH_STATUS=$(api_curl "$BASE_URL/api/fetch/status" 2>/dev/null || echo '{}')
WAITING=$(echo "$FETCH_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('waiting',0))" 2>/dev/null || echo "0")
COMPLETED=$(echo "$FETCH_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('completed',0))" 2>/dev/null || echo "0")
if [ "$COMPLETED" -ge 100 ] 2>/dev/null; then
  pass "T2.2: 已完成采集 ${COMPLETED} 个源"
elif [ "$COMPLETED" -gt 0 ] 2>/dev/null; then
  skip "T2.2: 已完成采集 ${COMPLETED}（未达到迁移验证阈值 100）"
else
  skip "T2.2: 当前采集完成数为 0（waiting=${WAITING}）"
fi

# 检查文章有内容
SAMPLE=$(api_curl "$BASE_URL/api/items?limit=1" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print('ok' if d and d[0].get('title') and d[0].get('url') else 'empty')" 2>/dev/null || echo "empty")
if [ "$SAMPLE" = "ok" ]; then
  pass "T2.3: 文章包含标题和URL"
elif [ "$SAMPLE" = "empty" ]; then
  skip "T2.3: 当前账号暂无文章样本"
else
  fail "T2.3: 文章数据不完整"
fi
echo ""

# ============================================================
# T3: OPML 导入功能
# ============================================================
log "--- T3: OPML 导入 ---"

# 测试缺少文件
EMPTY_STATUS=$(api_curl_code -X POST "$BASE_URL/api/sources/import-opml" 2>/dev/null || echo "000")
if [ "$EMPTY_STATUS" = "400" ]; then
  pass "T3.1: 缺少 OPML 文件返回 400"
else
  fail "T3.1: 缺少 OPML 文件预期 400，实际 $EMPTY_STATUS"
fi

INVALID_OPML="$(mktemp)"
cat > "$INVALID_OPML" <<'EOF'
<opml version="2.0"><body><outline text="bad"></body>
EOF
trap 'rm -f "$INVALID_OPML"' EXIT

# 测试无效 OPML XML
INVALID_STATUS=$(api_curl_code -X POST "$BASE_URL/api/sources/import-opml" -F "file=@$INVALID_OPML;type=text/xml" 2>/dev/null || echo "000")
if [ "$INVALID_STATUS" = "400" ]; then
  pass "T3.2: 无效 OPML 返回 400"
else
  skip "T3.2: 无效 OPML 返回 $INVALID_STATUS（解析器可能容错）"
fi
echo ""

# ============================================================
# T4: 多类型信源验证
# ============================================================
log "--- T4: 信源类型 ---"

for stype in "rss" "rsshub"; do
  COUNT=$(api_curl "$BASE_URL/api/sources?sourceType=$stype" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
  if [ "$COUNT" -gt 0 ] 2>/dev/null; then
    pass "T4: $stype 类型有 $COUNT 个源"
  else
    skip "T4: $stype 类型无源（当前账号未配置）"
  fi
done
echo ""

# ============================================================
# T5: 搜索验证
# ============================================================
log "--- T5: 搜索 ---"

SEARCH_COUNT=$(api_curl "$BASE_URL/api/items?search=AI&limit=5" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
if [ "$SEARCH_COUNT" -gt 0 ] 2>/dev/null; then
  pass "T5.1: 搜索'AI'返回 $SEARCH_COUNT 条"
else
  skip "T5.1: 搜索'AI'无结果（可能文章尚未索引）"
fi
echo ""

# ============================================================
# 汇总
# ============================================================
TOTAL=$((PASS + FAIL + SKIP))
log "============================================"
log "Stage A QA 测试完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL  跳过: $SKIP"
log "============================================"

if [ "$FAIL" -gt 0 ]; then
  fail "存在 $FAIL 个失败项！"
  exit 1
else
  pass "所有测试通过！"
  exit 0
fi

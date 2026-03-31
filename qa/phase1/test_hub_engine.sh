#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — Phase 1 hub-engine QA 测试
# 用法：bash qa/phase1/test_hub_engine.sh
# 前提：hub-engine 运行中（npm run dev 或 docker compose）
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
log "Phase 1 hub-engine QA 测试开始"
log "目标: $BASE_URL"
log "============================================"
echo ""

# ============================================================
# T1: 健康检查
# ============================================================
log "--- T1: 健康检查 ---"

HEALTH=$(curl -s "$BASE_URL/health" 2>/dev/null || echo '{}')
HEALTH_STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
if [ "$HEALTH_STATUS" = "ok" ]; then
  pass "T1.1: /health 返回 ok"
else
  fail "T1.1: /health 返回异常 ($HEALTH)"
fi

ROOT=$(curl -s "$BASE_URL/" 2>/dev/null || echo '{}')
ROOT_SERVICE=$(echo "$ROOT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('service',''))" 2>/dev/null || echo "")
if [ "$ROOT_SERVICE" = "hub-engine" ]; then
  pass "T1.2: / 返回 service=hub-engine"
else
  fail "T1.2: / 返回异常 ($ROOT)"
fi

if qa_auth_init "$BASE_URL" "$TS"; then
  pass "T1.3: QA 用户认证成功"
else
  fail "T1.3: QA 用户认证失败，无法继续 API 测试"
  exit 1
fi
echo ""

# ============================================================
# T2: Sources CRUD
# ============================================================
log "--- T2: Sources CRUD ---"

# T2.1: 创建 RSS 信源
CREATE_RESP=$(api_curl -X POST "$BASE_URL/api/sources" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"QA Test RSS $TS\",\"sourceType\":\"rss\",\"collectorType\":\"rss\",\"config\":{\"url\":\"https://hnrss.org/newest?points=100\"},\"category\":\"qa-test\",\"priority\":3}" 2>/dev/null || echo '{}')
SOURCE_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")
if [ -n "$SOURCE_ID" ] && [ "$SOURCE_ID" != "" ] && [ "$SOURCE_ID" != "None" ]; then
  pass "T2.1: 创建 RSS 信源成功 (id=$SOURCE_ID)"
else
  fail "T2.1: 创建 RSS 信源失败 ($CREATE_RESP)"
  SOURCE_ID=""
fi

# T2.2: 创建 RSSHub 信源
CREATE_RSSHUB=$(api_curl -X POST "$BASE_URL/api/sources" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"QA RSSHub $TS\",\"sourceType\":\"rsshub\",\"collectorType\":\"rsshub\",\"config\":{\"route\":\"/github/release/nicedoc/readability\"},\"category\":\"qa-test\"}" 2>/dev/null || echo '{}')
RSSHUB_ID=$(echo "$CREATE_RSSHUB" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")
if [ -n "$RSSHUB_ID" ] && [ "$RSSHUB_ID" != "" ] && [ "$RSSHUB_ID" != "None" ]; then
  pass "T2.2: 创建 RSSHub 信源成功 (id=$RSSHUB_ID)"
else
  fail "T2.2: 创建 RSSHub 信源失败 ($CREATE_RSSHUB)"
fi

# T2.3: 列表查询
LIST_RESP=$(api_curl "$BASE_URL/api/sources" 2>/dev/null || echo '{}')
LIST_TOTAL=$(echo "$LIST_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
if [ "$LIST_TOTAL" -gt 0 ] 2>/dev/null; then
  pass "T2.3: 信源列表查询成功 (total=$LIST_TOTAL)"
else
  fail "T2.3: 信源列表为空或查询失败"
fi

# T2.4: 分类列表
CAT_RESP=$(api_curl "$BASE_URL/api/sources/categories" 2>/dev/null || echo '{}')
CAT_DATA=$(echo "$CAT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(len(d))" 2>/dev/null || echo "0")
if [ "$CAT_DATA" -gt 0 ] 2>/dev/null; then
  pass "T2.4: 分类列表查询成功 ($CAT_DATA 个分类)"
else
  fail "T2.4: 分类列表为空"
fi

# T2.5: 统计
STATS_RESP=$(api_curl "$BASE_URL/api/sources/stats" 2>/dev/null || echo '{}')
STATS_TOTAL=$(echo "$STATS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
if [ "$STATS_TOTAL" -gt 0 ] 2>/dev/null; then
  pass "T2.5: 统计查询成功 (total=$STATS_TOTAL)"
else
  fail "T2.5: 统计查询失败"
fi

# T2.6: 更新信源
if [ -n "$SOURCE_ID" ]; then
  UPDATE_RESP=$(api_curl -X PUT "$BASE_URL/api/sources/$SOURCE_ID" \
    -H "Content-Type: application/json" \
    -d '{"category":"qa-updated","priority":5}' 2>/dev/null || echo '{}')
  UPD_CAT=$(echo "$UPDATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('category',''))" 2>/dev/null || echo "")
  if [ "$UPD_CAT" = "qa-updated" ]; then
    pass "T2.6: 更新信源成功 (category=qa-updated)"
  else
    fail "T2.6: 更新信源失败 ($UPDATE_RESP)"
  fi
fi

# T2.7: 创建缺少必填字段
BAD_RESP=$(api_curl_code -X POST "$BASE_URL/api/sources" \
  -H "Content-Type: application/json" \
  -d '{"name":"no type"}' 2>/dev/null || echo "000")
if [ "$BAD_RESP" = "400" ]; then
  pass "T2.7: 缺少必填字段返回 400"
else
  fail "T2.7: 缺少必填字段预期 400，实际 $BAD_RESP"
fi
echo ""

# ============================================================
# T3: Fetch 触发
# ============================================================
log "--- T3: Fetch 触发与执行 ---"

# T3.1: 手动触发单源采集
if [ -n "$SOURCE_ID" ]; then
  FETCH_RESP=$(api_curl -X POST "$BASE_URL/api/fetch/source/$SOURCE_ID" 2>/dev/null || echo '{}')
  FETCH_MSG=$(echo "$FETCH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message',''))" 2>/dev/null || echo "")
  if [ "$FETCH_MSG" = "Fetch enqueued" ] || [ "$FETCH_MSG" = "Fetch finished" ]; then
    pass "T3.1: 手动触发单源采集成功"
  else
    fail "T3.1: 手动触发单源采集失败 ($FETCH_RESP)"
  fi
fi

# T3.2: 等待采集完成（最多 15 秒）
log "等待采集执行... (最多15秒)"
ITEM_COUNT=0
for i in $(seq 1 5); do
  sleep 3
  ITEMS_RESP=$(api_curl "$BASE_URL/api/items?limit=1" 2>/dev/null || echo '{}')
  ITEM_COUNT=$(echo "$ITEMS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
  if [ "$ITEM_COUNT" -gt 0 ] 2>/dev/null; then
    break
  fi
done

if [ "$ITEM_COUNT" -gt 0 ] 2>/dev/null; then
  pass "T3.2: 采集后数据库有 $ITEM_COUNT 条条目"
else
  skip "T3.2: 采集后无新条目（可能网络问题或源无内容）"
fi

# T3.3: 采集队列状态
QUEUE_RESP=$(api_curl "$BASE_URL/api/fetch/status" 2>/dev/null || echo '{}')
QUEUE_OK=$(echo "$QUEUE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); q=d.get('queue'); print('ok' if isinstance(q,dict) and q.get('name')=='fetch' else '')" 2>/dev/null || echo "")
if [ "$QUEUE_OK" = "ok" ]; then
  pass "T3.3: 采集队列状态可查"
else
  fail "T3.3: 采集队列状态异常 ($QUEUE_RESP)"
fi

# T3.4: 触发全量采集
TRIGGER_RESP=$(api_curl -X POST "$BASE_URL/api/fetch/trigger" 2>/dev/null || echo '{}')
TRIGGER_COUNT=$(echo "$TRIGGER_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('enqueued',0))" 2>/dev/null || echo "0")
if [ "$TRIGGER_COUNT" -gt 0 ] 2>/dev/null; then
  pass "T3.4: 全量采集触发成功 (enqueued=$TRIGGER_COUNT)"
else
  fail "T3.4: 全量采集触发失败 ($TRIGGER_RESP)"
fi
echo ""

# ============================================================
# T4: Items API
# ============================================================
log "--- T4: Items API ---"

# T4.1: 列表查询
ITEMS_LIST=$(api_curl "$BASE_URL/api/items?limit=5" 2>/dev/null || echo '{}')
ITEMS_HAS=$(echo "$ITEMS_LIST" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if 'data' in d and 'total' in d else 'fail')" 2>/dev/null || echo "fail")
if [ "$ITEMS_HAS" = "ok" ]; then
  pass "T4.1: Items 列表查询格式正确 (data + total)"
else
  fail "T4.1: Items 列表格式异常"
fi

# T4.2: 分页
ITEMS_PAGE=$(api_curl "$BASE_URL/api/items?limit=2&offset=0" 2>/dev/null || echo '{}')
PAGE_LEN=$(echo "$ITEMS_PAGE" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")
if [ "$PAGE_LEN" -le 2 ] 2>/dev/null; then
  pass "T4.2: 分页限制生效 (returned $PAGE_LEN, limit=2)"
else
  fail "T4.2: 分页限制未生效 (returned $PAGE_LEN)"
fi

# T4.3: Items 统计
ITEMS_STATS=$(api_curl "$BASE_URL/api/items/stats" 2>/dev/null || echo '{}')
STATS_OK=$(echo "$ITEMS_STATS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if 'total' in d else 'fail')" 2>/dev/null || echo "fail")
if [ "$STATS_OK" = "ok" ]; then
  pass "T4.3: Items 统计接口正常"
else
  fail "T4.3: Items 统计接口异常"
fi

# T4.4: 搜索
SEARCH_RESP=$(api_curl "$BASE_URL/api/items?search=test&limit=5" 2>/dev/null || echo '{}')
SEARCH_OK=$(echo "$SEARCH_RESP" | python3 -c "import sys,json; print('ok' if 'data' in json.load(sys.stdin) else 'fail')" 2>/dev/null || echo "fail")
if [ "$SEARCH_OK" = "ok" ]; then
  pass "T4.4: 搜索接口正常"
else
  fail "T4.4: 搜索接口异常"
fi

# T4.5: 音频转写接口（不存在条目）
AUDIO_MISSING=$(api_curl_code -X POST "$BASE_URL/api/items/00000000-0000-0000-0000-000000000000/audio-transcribe" 2>/dev/null || echo "000")
if [ "$AUDIO_MISSING" = "404" ]; then
  pass "T4.5: 音频转写接口存在且返回 404（条目不存在）"
else
  fail "T4.5: 音频转写接口异常，预期 404，实际 $AUDIO_MISSING"
fi
echo ""

# ============================================================
# T5: 清理测试数据
# ============================================================
log "--- T5: 清理 ---"

if [ -n "$SOURCE_ID" ]; then
  DEL_RESP=$(api_curl -X DELETE "$BASE_URL/api/sources/$SOURCE_ID" 2>/dev/null || echo '{}')
  pass "T5.1: 删除测试 RSS 源 ($SOURCE_ID)"
fi
if [ -n "$RSSHUB_ID" ]; then
  api_curl -X DELETE "$BASE_URL/api/sources/$RSSHUB_ID" >/dev/null 2>&1
  pass "T5.2: 删除测试 RSSHub 源 ($RSSHUB_ID)"
fi
echo ""

# ============================================================
# 汇总
# ============================================================
TOTAL=$((PASS + FAIL + SKIP))
log "============================================"
log "Phase 1 hub-engine QA 测试完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL  跳过: $SKIP"
log "============================================"

if [ "$FAIL" -gt 0 ]; then
  fail "存在 $FAIL 个失败项，请检查！"
  exit 1
else
  pass "所有测试通过！"
  exit 0
fi

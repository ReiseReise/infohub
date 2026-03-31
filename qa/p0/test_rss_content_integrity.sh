#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — P0 RSS 内容完整性回归
# 用法：bash qa/p0/test_rss_content_integrity.sh
# 目标：验证 content:encoded、来源字段、媒体字段、详情内容完整性
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; RESET='\033[0m'
PASS=0; FAIL=0

log()  { printf "%b[QA]%b %s\n" "$CYAN" "$RESET" "$*"; }
pass() { printf "%b[PASS]%b %s\n" "$GREEN" "$RESET" "$*"; PASS=$((PASS+1)); }
fail() { printf "%b[FAIL]%b %s\n" "$RED" "$RESET" "$*"; FAIL=$((FAIL+1)); }

BASE_URL="${HUB_ENGINE_URL:-http://127.0.0.1:3001}"
FIXTURE_PORT="${RSS_FIXTURE_PORT:-18082}"
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
log "P0 RSS 内容完整性回归开始"
log "目标: $BASE_URL"
log "============================================"
echo ""

cat > "$TMP_DIR/test-feed.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>QA Feed</title>
    <link>https://example.com</link>
    <description>QA feed for parser</description>
    <item>
      <title>Transcript for OpenClaw: The Viral AI Agent that Broke the Internet</title>
      <link>https://qa.example.com/openclaw-transcript</link>
      <guid>qa-openclaw-001</guid>
      <pubDate>Wed, 04 Mar 2026 02:00:00 GMT</pubDate>
      <description><![CDATA[Short description only.]]></description>
      <content:encoded><![CDATA[
        <article>
          <h1>QA 内容完整性验证</h1>
          <p>QA段落A：这是一段用于验证 content:encoded 优先读取的文本，长度需要足够，确保详情页不会触发懒加载抓取逻辑。</p>
          <p>QA段落B：我们希望在条目详情中仍然能看到原始 RSS 正文内容，而不是被错误覆盖或渲染成转义字符。</p>
          <p>QA段落C：该段落继续拉长文本，覆盖多段落场景，用来验证 snippet 生成和详情内容长度是否符合预期。</p>
          <p>QA段落D：如果系统读取了 description 而不是 content:encoded，内容长度会明显不足，这个断言会失败。</p>
          <p>QA段落E：本段落为最终兜底，确保纯文本长度超过 280，阻断详情页 fallback 抓取外部网页。</p>
        </article>
      ]]></content:encoded>
      <enclosure url="https://example.com/audio/test.mp3" type="audio/mpeg" />
    </item>
  </channel>
</rss>
XML

python3 -m http.server "$FIXTURE_PORT" --directory "$TMP_DIR" >/tmp/infohub-rss-fixture.log 2>&1 &
SERVER_PID=$!
sleep 1

TS="$(date +%s)"
REG=$(curl -sS -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"qa_rss_fix_${TS}@example.com\",\"username\":\"qarssfix${TS}\",\"password\":\"Passw0rd!${TS}\"}" 2>/dev/null || echo '{}')
TOKEN=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo "")
if [ -n "$TOKEN" ]; then
  pass "T1: 注册并获取 token 成功"
else
  fail "T1: 注册失败 ($REG)"
  exit 1
fi

SOURCE_NAME_EXPECTED="QA RSS Fixture ${TS}"
SRC=$(curl -sS -X POST "$BASE_URL/api/sources" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${SOURCE_NAME_EXPECTED}\",\"sourceType\":\"rss\",\"collectorType\":\"rss\",\"config\":{\"url\":\"http://host.docker.internal:${FIXTURE_PORT}/test-feed.xml\"},\"category\":\"qa\"}" 2>/dev/null || echo '{}')
SOURCE_ID=$(echo "$SRC" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")
if [ -n "$SOURCE_ID" ] && [ "$SOURCE_ID" != "None" ]; then
  pass "T2: 创建 RSS 信源成功 (id=$SOURCE_ID)"
else
  fail "T2: 创建 RSS 信源失败 ($SRC)"
  exit 1
fi

FETCH=$(curl -sS -X POST "$BASE_URL/api/fetch/source/$SOURCE_ID?mode=sync" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{}')
FETCH_MSG=$(echo "$FETCH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message',''))" 2>/dev/null || echo "")
if [ "$FETCH_MSG" = "Fetch finished" ] || [ "$FETCH_MSG" = "Fetch enqueued" ]; then
  pass "T3: 采集触发成功 ($FETCH_MSG)"
else
  fail "T3: 采集触发失败 ($FETCH)"
fi

ITEMS=$(curl -sS "$BASE_URL/api/items?limit=10&includeFiltered=true" -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{}')
TOTAL=$(echo "$ITEMS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
if [ "$TOTAL" -ge 1 ] 2>/dev/null; then
  pass "T4: 条目入库成功 (total=$TOTAL)"
else
  fail "T4: 条目入库失败 ($ITEMS)"
  exit 1
fi

ITEM_ID=$(echo "$ITEMS" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0].get('id','') if d else '')" 2>/dev/null || echo "")
LIST_SOURCE_NAME=$(echo "$ITEMS" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0].get('sourceName','') if d else '')" 2>/dev/null || echo "")
LIST_SOURCE_CATEGORY=$(echo "$ITEMS" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0].get('sourceCategory','') if d else '')" 2>/dev/null || echo "")
LIST_MEDIA_TYPE=$(echo "$ITEMS" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0].get('mediaType','') if d else '')" 2>/dev/null || echo "")
LIST_MEDIA_URL=$(echo "$ITEMS" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0].get('mediaUrl','') if d else '')" 2>/dev/null || echo "")
LIST_SNIPPET_LEN=$(echo "$ITEMS" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(len((d[0].get('snippet') or '')) if d else 0)" 2>/dev/null || echo "0")

if [ "$LIST_SOURCE_NAME" = "$SOURCE_NAME_EXPECTED" ]; then
  pass "T5: 列表 sourceName 正确"
else
  fail "T5: 列表 sourceName 异常 (got=$LIST_SOURCE_NAME)"
fi

if [ "$LIST_SOURCE_CATEGORY" = "qa" ]; then
  pass "T6: 列表 sourceCategory 正确"
else
  fail "T6: 列表 sourceCategory 异常 (got=$LIST_SOURCE_CATEGORY)"
fi

if [ "$LIST_MEDIA_TYPE" = "audio" ] && [ "$LIST_MEDIA_URL" = "https://example.com/audio/test.mp3" ]; then
  pass "T7: 列表媒体字段正确"
else
  fail "T7: 列表媒体字段异常 (type=$LIST_MEDIA_TYPE, url=$LIST_MEDIA_URL)"
fi

if [ "$LIST_SNIPPET_LEN" -gt 80 ] 2>/dev/null; then
  pass "T8: snippet 长度符合预期 ($LIST_SNIPPET_LEN)"
else
  fail "T8: snippet 过短 ($LIST_SNIPPET_LEN)"
fi

DETAIL=$(curl -sS "$BASE_URL/api/items/$ITEM_ID" -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{}')
DETAIL_SOURCE_NAME=$(echo "$DETAIL" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('sourceName',''))" 2>/dev/null || echo "")
DETAIL_CONTENT_LEN=$(echo "$DETAIL" | python3 -c "import sys,json; print(len((json.load(sys.stdin).get('data',{}).get('content') or '')))" 2>/dev/null || echo "0")
DETAIL_HAS_QA=$(echo "$DETAIL" | python3 -c "import sys,json; c=(json.load(sys.stdin).get('data',{}).get('content') or ''); print('yes' if ('QA段落A' in c and 'QA段落E' in c) else 'no')" 2>/dev/null || echo "no")

if [ "$DETAIL_SOURCE_NAME" = "$SOURCE_NAME_EXPECTED" ]; then
  pass "T9: 详情 sourceName 正确"
else
  fail "T9: 详情 sourceName 异常 (got=$DETAIL_SOURCE_NAME)"
fi

if [ "$DETAIL_CONTENT_LEN" -gt 280 ] 2>/dev/null; then
  pass "T10: 详情 content 长度符合预期 ($DETAIL_CONTENT_LEN)"
else
  fail "T10: 详情 content 过短 ($DETAIL_CONTENT_LEN)"
fi

if [ "$DETAIL_HAS_QA" = "yes" ]; then
  pass "T11: 详情 content 保留 RSS 正文关键段落"
else
  fail "T11: 详情 content 未包含预期正文片段"
fi

curl -sS -X DELETE "$BASE_URL/api/sources/$SOURCE_ID" -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true

echo ""
TOTAL=$((PASS + FAIL))
log "============================================"
log "P0 RSS 内容完整性回归完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL"
log "============================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

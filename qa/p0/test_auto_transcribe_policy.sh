#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — P0 自动转写策略回归
# 用法：bash qa/p0/test_auto_transcribe_policy.sh
# 目标：验证 source 级开关 + 全局开关 + 每日自动上限生效
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; RESET='\033[0m'
PASS=0; FAIL=0

log()  { printf "%b[QA]%b %s\n" "$CYAN" "$RESET" "$*"; }
pass() { printf "%b[PASS]%b %s\n" "$GREEN" "$RESET" "$*"; PASS=$((PASS+1)); }
fail() { printf "%b[FAIL]%b %s\n" "$RED" "$RESET" "$*"; FAIL=$((FAIL+1)); }

HUB_URL="${HUB_ENGINE_URL:-http://127.0.0.1:3001}"
AUDIO_URL="${AUDIO_SERVICE_URL:-http://127.0.0.1:8000}"
FIXTURE_PORT="${AUTO_TRANSCRIBE_FIXTURE_PORT:-18083}"
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
log "P0 自动转写策略回归开始"
log "Hub: $HUB_URL"
log "Audio: $AUDIO_URL"
log "============================================"
echo ""

python3 - <<'PY' "$TMP_DIR"
import math
import struct
import sys
import wave
from pathlib import Path

root = Path(sys.argv[1])
sample_rate = 16000
duration = 1.2
frames = int(sample_rate * duration)

for idx, freq in enumerate((330, 440), start=1):
    path = root / f"sample-{idx}.wav"
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        for i in range(frames):
            value = int(16000 * math.sin(2 * math.pi * freq * i / sample_rate))
            wf.writeframes(struct.pack("<h", value))
PY

cat > "$TMP_DIR/auto-feed.xml" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>QA Auto Transcribe Feed</title>
    <link>https://example.com/auto</link>
    <description>QA feed for automatic transcribe policy</description>
    <item>
      <title>QA 自动转写条目 A</title>
      <link>https://qa.example.com/auto-a</link>
      <guid>qa-auto-a</guid>
      <pubDate>Fri, 06 Mar 2026 03:00:00 GMT</pubDate>
      <description><![CDATA[第一个音频条目，用于验证自动转写会被触发。]]></description>
      <enclosure url="http://host.docker.internal:${FIXTURE_PORT}/sample-1.wav" type="audio/wav" />
    </item>
    <item>
      <title>QA 自动转写条目 B</title>
      <link>https://qa.example.com/auto-b</link>
      <guid>qa-auto-b</guid>
      <pubDate>Fri, 06 Mar 2026 03:05:00 GMT</pubDate>
      <description><![CDATA[第二个音频条目，用于验证每日自动上限会拦住额外任务。]]></description>
      <enclosure url="http://host.docker.internal:${FIXTURE_PORT}/sample-2.wav" type="audio/wav" />
    </item>
  </channel>
</rss>
XML

python3 -m http.server "$FIXTURE_PORT" --directory "$TMP_DIR" >/tmp/infohub-auto-transcribe-fixture.log 2>&1 &
SERVER_PID=$!
sleep 1

TS="$(date +%s)"
REG=$(curl -sS -X POST "$HUB_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"qa_auto_tr_${TS}@example.com\",\"username\":\"qaautotr${TS}\",\"password\":\"Passw0rd!${TS}\"}" 2>/dev/null || echo '{}')
TOKEN=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo "")
if [ -n "$TOKEN" ]; then
  pass "T1: 注册并获取 token 成功"
else
  fail "T1: 注册失败 ($REG)"
  exit 1
fi

QUOTA=$(curl -sS -X PUT "$HUB_URL/api/quota/me" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"autoTranscribeEnabled":true,"maxAutoPerDay":1}' 2>/dev/null || echo '{}')
QUOTA_OK=$(echo "$QUOTA" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print('yes' if d.get('autoTranscribeEnabled') and d.get('maxAutoPerDay') == 1 else 'no')" 2>/dev/null || echo "no")
if [ "$QUOTA_OK" = "yes" ]; then
  pass "T2: 全局自动转写与每日上限配置成功"
else
  fail "T2: 配额设置失败 ($QUOTA)"
  exit 1
fi

SOURCE_NAME="QA Auto Source ${TS}"
SRC=$(curl -sS -X POST "$HUB_URL/api/sources" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${SOURCE_NAME}\",\"sourceType\":\"podcast\",\"collectorType\":\"rss\",\"config\":{\"url\":\"http://host.docker.internal:${FIXTURE_PORT}/auto-feed.xml\"},\"category\":\"qa\",\"autoTranscribe\":true}" 2>/dev/null || echo '{}')
SOURCE_ID=$(echo "$SRC" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")
SOURCE_AUTO=$(echo "$SRC" | python3 -c "import sys,json; print('yes' if json.load(sys.stdin).get('data',{}).get('autoTranscribe') else 'no')" 2>/dev/null || echo "no")
if [ -n "$SOURCE_ID" ] && [ "$SOURCE_ID" != "None" ] && [ "$SOURCE_AUTO" = "yes" ]; then
  pass "T3: 自动转写信源创建成功 (id=$SOURCE_ID)"
else
  fail "T3: 信源创建失败 ($SRC)"
  exit 1
fi

FETCH=$(curl -sS -X POST "$HUB_URL/api/fetch/source/$SOURCE_ID?mode=sync" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{}')
FETCH_MSG=$(echo "$FETCH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message',''))" 2>/dev/null || echo "")
if [ "$FETCH_MSG" = "Fetch finished" ] || [ "$FETCH_MSG" = "Fetch enqueued" ]; then
  pass "T4: 采集触发成功 ($FETCH_MSG)"
else
  fail "T4: 采集触发失败 ($FETCH)"
  exit 1
fi

STARTED_COUNT=0
IDLE_COUNT=0
TASK_TOTAL=0
for i in $(seq 1 12); do
  sleep 2
  ITEMS=$(curl -sS "$HUB_URL/api/items?limit=20" -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{}')
  COUNTS=$(echo "$ITEMS" | python3 -c "import sys,json; data=json.load(sys.stdin).get('data',[]); started=sum(1 for item in data if item.get('audioTaskId') and item.get('audioStatus') not in ('', None, 'none')); idle=sum(1 for item in data if item.get('audioStatus') == 'none'); total=len(data); print(f'{started}:{idle}:{total}')" 2>/dev/null || echo "0:0:0")
  STARTED_COUNT="${COUNTS%%:*}"
  REST="${COUNTS#*:}"
  IDLE_COUNT="${REST%%:*}"
  ITEM_TOTAL="${REST#*:}"

  TASKS=$(curl -sS "$AUDIO_URL/api/tasks?page=1&page_size=20" -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{}')
  TASK_TOTAL=$(echo "$TASKS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('items',[])))" 2>/dev/null || echo "0")

  log "轮询 #$i: items=$ITEM_TOTAL started=$STARTED_COUNT idle=$IDLE_COUNT tasks=$TASK_TOTAL"

  if [ "$ITEM_TOTAL" -ge 2 ] 2>/dev/null && [ "$STARTED_COUNT" -eq 1 ] 2>/dev/null && [ "$TASK_TOTAL" -eq 1 ] 2>/dev/null; then
    break
  fi
done

if [ "$STARTED_COUNT" -eq 1 ] 2>/dev/null; then
  pass "T5: 仅 1 条新音频触发自动转写"
else
  fail "T5: 自动转写触发数量异常 (started=$STARTED_COUNT)"
fi

if [ "$IDLE_COUNT" -ge 1 ] 2>/dev/null; then
  pass "T6: 超过每日上限的条目保持未自动转写"
else
  fail "T6: 未观察到被上限拦住的条目 (idle=$IDLE_COUNT)"
fi

if [ "$TASK_TOTAL" -eq 1 ] 2>/dev/null; then
  pass "T7: audio-service 仅创建 1 个任务"
else
  fail "T7: audio-service 任务数异常 (tasks=$TASK_TOTAL)"
fi

curl -sS -X DELETE "$HUB_URL/api/sources/$SOURCE_ID" -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true

echo ""
TOTAL=$((PASS + FAIL))
log "============================================"
log "P0 自动转写策略回归完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL"
log "============================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

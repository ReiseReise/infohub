#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — P0 前端 E2E（Folo 集成关键路径）
# 覆盖: Sources 发现订阅 / Feed 阅读链路 / Settings 诊断中心
# 用法: bash qa/p0/test_frontend_e2e_folo.sh
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; RESET='\033[0m'
PASS=0; FAIL=0; SKIP=0

log()  { printf "%b[QA]%b %s\n" "$CYAN" "$RESET" "$*"; }
pass() { printf "%b[PASS]%b %s\n" "$GREEN" "$RESET" "$*"; PASS=$((PASS+1)); }
fail() { printf "%b[FAIL]%b %s\n" "$RED" "$RESET" "$*"; FAIL=$((FAIL+1)); }
skip() { printf "%b[SKIP]%b %s\n" "$YELLOW" "$RESET" "$*"; SKIP=$((SKIP+1)); }

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HELPER_DIR="$(cd "$(dirname "$0")/.." && pwd)/helpers"
source "$HELPER_DIR/auth.sh"

HUB_PORT="${HUB_ENGINE_PORT:-3901}"
HUB_URL="${HUB_ENGINE_URL:-http://127.0.0.1:${HUB_PORT}}"
WEB_PORT="${WEB_PORT:-5179}"
WEB_URL="${WEB_URL:-http://127.0.0.1:${WEB_PORT}}"
TS="$(date +%s)"
FEED_PORT="${FEED_PORT:-$((18084 + (TS % 1000)))}"

ENGINE_PID=""
WEB_PID=""
FEED_SERVER_PID=""
TEMP_DIR=""
CREATED_SOURCE_IDS=()

wait_http_ready() {
  local url="$1"
  local retries="${2:-30}"
  local delay="${3:-1}"
  for _ in $(seq 1 "$retries"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

cleanup() {
  for source_id in "${CREATED_SOURCE_IDS[@]:-}"; do
    if [[ -n "${source_id:-}" ]]; then
      api_curl -X DELETE "$HUB_URL/api/sources/$source_id" >/dev/null 2>&1 || true
    fi
  done

  if [[ -n "$ENGINE_PID" ]] && kill -0 "$ENGINE_PID" >/dev/null 2>&1; then
    kill "$ENGINE_PID" >/dev/null 2>&1 || true
    wait "$ENGINE_PID" 2>/dev/null || true
  fi
  if [[ -n "$WEB_PID" ]] && kill -0 "$WEB_PID" >/dev/null 2>&1; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "$FEED_SERVER_PID" ]] && kill -0 "$FEED_SERVER_PID" >/dev/null 2>&1; then
    kill "$FEED_SERVER_PID" >/dev/null 2>&1 || true
    wait "$FEED_SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$TEMP_DIR" ]] && [[ -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT

log "============================================"
log "P0 前端 E2E（Folo 集成关键路径）开始"
log "Hub: $HUB_URL"
log "Web: $WEB_URL"
log "============================================"
echo ""

# ------------------------------------------------------------
# T0: 依赖检查
# ------------------------------------------------------------
if python3 - <<'PY' >/dev/null 2>&1
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    b.close()
PY
then
  pass "T0.1: Playwright Python 可用"
else
  fail "T0.1: Playwright Python 不可用，无法执行 E2E"
  exit 1
fi

# ------------------------------------------------------------
# T1: 启动 hub-engine（新代码实例）
# ------------------------------------------------------------
log "--- T1: 启动后端实例 ---"
(cd "$ROOT_DIR/services/hub-engine" && PORT="$HUB_PORT" npm run dev > "$ROOT_DIR/qa/reports/e2e-hub-${TS}.log" 2>&1) &
ENGINE_PID=$!
if wait_http_ready "$HUB_URL/health" 40 1; then
  pass "T1.1: hub-engine 已就绪"
else
  fail "T1.1: hub-engine 启动失败（见 qa/reports/e2e-hub-${TS}.log）"
  exit 1
fi

# ------------------------------------------------------------
# T2: 启动本地测试 RSS feed + 前端 dev server
# ------------------------------------------------------------
log "--- T2: 启动前端与测试数据源 ---"
TEMP_DIR="$(mktemp -d)"
cat > "$TEMP_DIR/feed.xml" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>InfoHub QA Feed ${TS}</title>
    <link>https://example.com</link>
    <description>QA deterministic feed</description>
    <item>
      <title>QA E2E Article ${TS}</title>
      <link>https://example.com/articles/${TS}</link>
      <guid>qa-${TS}</guid>
      <description>QA content body ${TS}</description>
      <pubDate>Wed, 05 Mar 2026 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
EOF

(cd "$TEMP_DIR" && python3 -m http.server "$FEED_PORT" > "$ROOT_DIR/qa/reports/e2e-feed-${TS}.log" 2>&1) &
FEED_SERVER_PID=$!
if wait_http_ready "http://127.0.0.1:${FEED_PORT}/feed.xml" 20 1; then
  pass "T2.1: 本地测试 feed 已就绪"
else
  fail "T2.1: 本地测试 feed 启动失败"
  exit 1
fi

(cd "$ROOT_DIR/apps/web" && VITE_API_PROXY_TARGET="$HUB_URL" npm run dev -- --host 127.0.0.1 --port "$WEB_PORT" > "$ROOT_DIR/qa/reports/e2e-web-${TS}.log" 2>&1) &
WEB_PID=$!
if wait_http_ready "$WEB_URL/login" 40 1; then
  pass "T2.2: 前端 dev server 已就绪"
else
  fail "T2.2: 前端 dev server 启动失败（见 qa/reports/e2e-web-${TS}.log）"
  exit 1
fi

# ------------------------------------------------------------
# T3: 认证与种子数据
# ------------------------------------------------------------
log "--- T3: 准备 E2E 用户与种子数据 ---"
if qa_auth_init "$HUB_URL" "e2e_folo_${TS}"; then
  pass "T3.1: QA 用户认证成功"
else
  fail "T3.1: QA 用户认证失败"
  exit 1
fi

SEED_SOURCE_RESP=$(api_curl -X POST "$HUB_URL/api/sources" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"E2E Seed Feed ${TS}\",\"sourceType\":\"rss\",\"collectorType\":\"rss\",\"config\":{\"url\":\"http://127.0.0.1:${FEED_PORT}/feed.xml\"},\"category\":\"qa-e2e\"}" 2>/dev/null || echo '{}')
SEED_SOURCE_ID=$(echo "$SEED_SOURCE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")
if [[ -n "$SEED_SOURCE_ID" && "$SEED_SOURCE_ID" != "None" ]]; then
  CREATED_SOURCE_IDS+=("$SEED_SOURCE_ID")
  pass "T3.2: 创建 seed source 成功 (id=$SEED_SOURCE_ID)"
else
  fail "T3.2: 创建 seed source 失败 ($SEED_SOURCE_RESP)"
  exit 1
fi

FETCH_RESP=$(api_curl -X POST "$HUB_URL/api/fetch/source/$SEED_SOURCE_ID?mode=sync" 2>/dev/null || echo '{}')
FETCH_MSG=$(echo "$FETCH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message',''))" 2>/dev/null || echo "")
if [[ "$FETCH_MSG" == "Fetch finished" || "$FETCH_MSG" == "Fetch enqueued" ]]; then
  pass "T3.3: 触发 seed source 抓取成功"
else
  fail "T3.3: 触发抓取失败 ($FETCH_RESP)"
  exit 1
fi

ITEM_TOTAL=0
for _ in $(seq 1 20); do
  ITEM_TOTAL=$(api_curl "$HUB_URL/api/items?limit=1" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
  if [[ "$ITEM_TOTAL" -gt 0 ]]; then
    break
  fi
  sleep 1
done
if [[ "$ITEM_TOTAL" -gt 0 ]]; then
  pass "T3.4: 已生成 feed 条目 (total=$ITEM_TOTAL)"
else
  fail "T3.4: 未生成 feed 条目"
  exit 1
fi

# ------------------------------------------------------------
# T4: Playwright E2E
# ------------------------------------------------------------
log "--- T4: Playwright 交互回归 ---"
export E2E_WEB_URL="$WEB_URL"
export E2E_EMAIL="$QA_EMAIL"
export E2E_PASSWORD="$QA_PASSWORD"
export E2E_DISCOVER_URL="http://127.0.0.1:${FEED_PORT}/feed.xml"

if python3 - <<'PY'
import os
import re
import sys
from playwright.sync_api import sync_playwright

web_url = os.environ["E2E_WEB_URL"]
email = os.environ["E2E_EMAIL"]
password = os.environ["E2E_PASSWORD"]
discover_url = os.environ["E2E_DISCOVER_URL"]

checks = []
errors = []

def ok(msg: str):
    checks.append(msg)
    print(f"[PW PASS] {msg}")

def bad(msg: str, err: Exception):
    errors.append(f"{msg}: {err}")
    print(f"[PW FAIL] {msg}: {err}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    try:
        page.goto(f"{web_url}/login", wait_until="domcontentloaded", timeout=20000)
        page.get_by_placeholder("you@example.com").fill(email)
        page.get_by_placeholder("请输入密码").fill(password)
        page.get_by_role("button", name="登录").click()
        page.wait_for_url(re.compile(r".*/feed.*"), timeout=20000)
        ok("登录后成功进入 Feed")
    except Exception as e:
        bad("登录流程", e)

    try:
        page.goto(f"{web_url}/sources", wait_until="domcontentloaded", timeout=20000)
        page.get_by_role("heading", name="信源管理").wait_for(timeout=10000)
        page.get_by_role("button", name="RSS URL").click()
        page.get_by_placeholder("关键词、站点 URL 或 RSS 链接").fill(discover_url)
        with page.expect_response(
            lambda resp: "/api/discovery/search" in resp.url,
            timeout=15000,
        ) as discovery_resp_info:
            page.get_by_role("button", name="发现").click()
        discovery_resp = discovery_resp_info.value
        if discovery_resp.status != 200:
            raise RuntimeError(f"发现接口状态异常: {discovery_resp.status}")
        discovery_data = discovery_resp.json().get("data") or []
        if len(discovery_data) == 0:
            raise RuntimeError("发现接口返回空结果")

        sub_btn = page.get_by_role("button", name="订阅", exact=True)
        if sub_btn.count() > 0:
            target_btn = sub_btn.first
            target_btn.click()
            page.wait_for_timeout(1200)
            # 允许多种成功态: 顶部提示、按钮进入已订阅态、或已展示已订阅按钮
            notice_ok = page.locator("text=已订阅").count() > 0 or page.locator("text=已在订阅列表中").count() > 0
            action_ok = page.get_by_role("button", name="已订阅").count() > 0 or target_btn.is_disabled()
            if not (notice_ok or action_ok):
                raise RuntimeError("订阅动作未进入可观察成功态")
            ok("Sources 发现后可触发订阅动作")
        else:
            already_btn = page.get_by_role("button", name="已订阅", exact=True)
            if already_btn.count() > 0:
                ok("Sources 发现结果已存在订阅状态")
            else:
                raise RuntimeError("发现结果未出现可点击的订阅按钮")
    except Exception as e:
        bad("Sources 发现订阅链路", e)

    try:
        page.goto(f"{web_url}/feed", wait_until="domcontentloaded", timeout=20000)
        page.get_by_role("button", name=re.compile(r"^未读")).click()
        cards = page.locator("div.cursor-pointer h3")
        cards.first.wait_for(timeout=15000)
        cards.first.click()
        page.wait_for_url(re.compile(r".*/feed/[^?]+.*"), timeout=10000)
        if "filter=unread" not in page.url:
            raise RuntimeError(f"url missing filter context: {page.url}")
        page.get_by_role("button", name="下一条未读").click()
        ok("Feed 详情链路与 query 上下文保持一致")
    except Exception as e:
        bad("Feed 阅读链路", e)

    try:
        page.goto(f"{web_url}/settings", wait_until="domcontentloaded", timeout=20000)
        page.get_by_role("button", name="诊断中心").click()
        page.locator("text=服务连通诊断").first.wait_for(timeout=10000)
        page.locator("text=仅管理员可查看队列作业详情。").first.wait_for(timeout=10000)
        page.get_by_placeholder("代理地址，如 http://127.0.0.1:7890").fill("bad-proxy")
        page.get_by_role("button", name="测试代理").click()
        page.wait_for_timeout(1500)
        err_visible = (
            page.locator("text=Invalid proxy URL").count() > 0
            or page.locator("text=代理测试失败").count() > 0
            or page.locator("div.text-red-700.bg-red-50").count() > 0
        )
        if not err_visible:
            raise RuntimeError("代理测试后未观察到错误反馈")
        ok("Settings 诊断中心与代理测试链路可用")
    except Exception as e:
        bad("Settings 诊断中心", e)

    browser.close()

if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)
PY
then
  pass "T4.1: 前端 E2E 三链路通过"
else
  fail "T4.1: 前端 E2E 失败"
fi

echo ""
TOTAL=$((PASS + FAIL + SKIP))
log "============================================"
log "P0 前端 E2E（Folo 集成关键路径）完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL  跳过: $SKIP"
log "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0

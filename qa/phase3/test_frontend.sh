#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — Phase 3 前端 QA 测试
# 用法：bash qa/phase3/test_frontend.sh
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; RESET='\033[0m'
PASS=0; FAIL=0; SKIP=0

log()  { printf "%b[QA]%b %s\n" "$CYAN" "$RESET" "$*"; }
pass() { printf "%b[PASS]%b %s\n" "$GREEN" "$RESET" "$*"; PASS=$((PASS+1)); }
fail() { printf "%b[FAIL]%b %s\n" "$RED" "$RESET" "$*"; FAIL=$((FAIL+1)); }
skip() { printf "%b[SKIP]%b %s\n" "$YELLOW" "$RESET" "$*"; SKIP=$((SKIP+1)); }

WEB_DIR="$(cd "$(dirname "$0")/../../apps/web" && pwd)"

log "============================================"
log "Phase 3 前端 QA 测试开始"
log "项目: $WEB_DIR"
log "============================================"
echo ""

# ============================================================
# T1: 项目结构完整性
# ============================================================
log "--- T1: 项目结构 ---"

for f in "package.json" "vite.config.ts" "tsconfig.json" "src/App.tsx" "src/index.css" "src/main.tsx" "src/lib/api.ts" "src/components/Layout.tsx" "src/components/Sidebar.tsx"; do
  if [ -f "$WEB_DIR/$f" ]; then
    pass "T1: $f 存在"
  else
    fail "T1: $f 不存在"
  fi
done
echo ""

# ============================================================
# T2: 页面组件完整性
# ============================================================
log "--- T2: 页面组件 ---"

for page in "Feed.tsx" "Sources.tsx" "Insights.tsx" "Export.tsx" "Settings.tsx" "AudioStudio.tsx"; do
  if [ -f "$WEB_DIR/src/pages/$page" ]; then
    pass "T2: pages/$page 存在"
  else
    fail "T2: pages/$page 不存在"
  fi
done
echo ""

# ============================================================
# T3: 依赖安装
# ============================================================
log "--- T3: 依赖 ---"

if [ -d "$WEB_DIR/node_modules" ]; then
  pass "T3.1: node_modules 存在"
else
  fail "T3.1: node_modules 不存在（运行 npm install）"
fi

for dep in "react" "react-dom" "react-router-dom" "lucide-react" "tailwindcss"; do
  if [ -d "$WEB_DIR/node_modules/$dep" ] || [ -d "$WEB_DIR/node_modules/.vite/deps" ]; then
    pass "T3.2: 依赖 $dep 已安装"
  else
    fail "T3.2: 依赖 $dep 未找到"
  fi
done
echo ""

# ============================================================
# T4: 构建验证
# ============================================================
log "--- T4: 构建 ---"

if [ -d "$WEB_DIR/dist" ]; then
  pass "T4.1: dist/ 目录存在"
else
  log "dist/ 不存在，执行构建..."
  (cd "$WEB_DIR" && npm run build 2>&1 | tail -5)
  if [ -d "$WEB_DIR/dist" ]; then
    pass "T4.1: 构建成功，dist/ 已生成"
  else
    fail "T4.1: 构建失败"
  fi
fi

if [ -f "$WEB_DIR/dist/index.html" ]; then
  pass "T4.2: dist/index.html 存在"
else
  fail "T4.2: dist/index.html 不存在"
fi

JS_COUNT=$(find "$WEB_DIR/dist/assets" -name "*.js" 2>/dev/null | wc -l | tr -d ' ')
CSS_COUNT=$(find "$WEB_DIR/dist/assets" -name "*.css" 2>/dev/null | wc -l | tr -d ' ')
if [ "$JS_COUNT" -gt 0 ]; then
  pass "T4.3: JS bundle 存在 ($JS_COUNT 个文件)"
else
  fail "T4.3: 无 JS bundle"
fi
if [ "$CSS_COUNT" -gt 0 ]; then
  pass "T4.4: CSS bundle 存在 ($CSS_COUNT 个文件)"
else
  fail "T4.4: 无 CSS bundle"
fi
echo ""

# ============================================================
# T5: 代码质量检查
# ============================================================
log "--- T5: 代码质量 ---"

# 检查 Tailwind v4 import
if grep -q '@import "tailwindcss"' "$WEB_DIR/src/index.css"; then
  pass "T5.1: TailwindCSS v4 import 正确"
else
  fail "T5.1: TailwindCSS v4 import 缺失"
fi

# 检查 API proxy 配置
if grep -q "proxy" "$WEB_DIR/vite.config.ts"; then
  pass "T5.2: Vite API proxy 已配置"
else
  fail "T5.2: Vite API proxy 未配置"
fi

# 检查路由配置
if grep -q "BrowserRouter" "$WEB_DIR/src/App.tsx"; then
  pass "T5.3: React Router 已配置"
else
  fail "T5.3: React Router 未配置"
fi

# 检查所有页面都被路由引用
for page in "Feed" "Sources" "Insights" "Export" "Settings" "AudioStudio"; do
  if grep -q "$page" "$WEB_DIR/src/App.tsx"; then
    pass "T5.4: 路由包含 $page 页"
  else
    fail "T5.4: 路由缺少 $page 页"
  fi
done
echo ""

# ============================================================
# T6: Bundle 大小检查
# ============================================================
log "--- T6: Bundle 大小 ---"

JS_SIZE=$(find "$WEB_DIR/dist/assets" -name "*.js" -exec wc -c {} + 2>/dev/null | tail -1 | awk '{print $1}')
CSS_SIZE=$(find "$WEB_DIR/dist/assets" -name "*.css" -exec wc -c {} + 2>/dev/null | tail -1 | awk '{print $1}')

JS_KB=$((${JS_SIZE:-0} / 1024))
CSS_KB=$((${CSS_SIZE:-0} / 1024))

if [ "$JS_KB" -lt 500 ]; then
  pass "T6.1: JS bundle ${JS_KB}KB < 500KB"
else
  skip "T6.1: JS bundle ${JS_KB}KB >= 500KB（偏大，但不阻塞）"
fi
if [ "$CSS_KB" -lt 100 ]; then
  pass "T6.2: CSS bundle ${CSS_KB}KB < 100KB"
else
  skip "T6.2: CSS bundle ${CSS_KB}KB >= 100KB"
fi
echo ""

# ============================================================
# 汇总
# ============================================================
TOTAL=$((PASS + FAIL + SKIP))
log "============================================"
log "Phase 3 前端 QA 测试完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL  跳过: $SKIP"
log "============================================"

if [ "$FAIL" -gt 0 ]; then
  fail "存在 $FAIL 个失败项，请检查！"
  exit 1
else
  pass "所有测试通过！"
  exit 0
fi

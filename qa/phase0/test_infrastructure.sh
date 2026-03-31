#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — Phase 0 基础设施 QA 测试
# 用法：bash qa/phase0/test_infrastructure.sh
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; RESET='\033[0m'
PASS=0; FAIL=0; SKIP=0

log()  { printf "%b[QA]%b %s\n" "$CYAN" "$RESET" "$*"; }
pass() { printf "%b[PASS]%b %s\n" "$GREEN" "$RESET" "$*"; PASS=$((PASS+1)); }
fail() { printf "%b[FAIL]%b %s\n" "$RED" "$RESET" "$*"; FAIL=$((FAIL+1)); }
skip() { printf "%b[SKIP]%b %s\n" "$YELLOW" "$RESET" "$*"; SKIP=$((SKIP+1)); }

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-infohub}"
PG_PASSWORD="${PG_PASSWORD:-infohub_dev_2026}"

RSSHUB_URL="${RSSHUB_URL:-http://localhost:1200}"
CD_URL="${CD_URL:-http://localhost:5555}"
NTFY_URL="${NTFY_URL:-http://localhost:8081}"
KTN_URL="${KTN_URL:-http://localhost:8082}"

log "============================================"
log "Phase 0 基础设施 QA 测试开始"
log "============================================"
echo ""

# ============================================================
# T1: Docker 容器状态检查
# ============================================================
log "--- T1: Docker 容器状态 ---"

check_container() {
  local name="$1"
  local status
  status=$(docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null || echo "not_found")
  if [ "$status" = "running" ]; then
    pass "T1.${2}: 容器 $name 运行中"
  else
    fail "T1.${2}: 容器 $name 状态异常 ($status)"
  fi
}

check_container "infohub-postgres"        1
check_container "infohub-redis"           2
check_container "infohub-rsshub"          3
check_container "infohub-changedetection" 4
check_container "infohub-ntfy"            5
echo ""

# ============================================================
# T2: PostgreSQL 连接与 Schema 验证
# ============================================================
log "--- T2: PostgreSQL 数据库 ---"

# 使用 docker exec 运行 psql（无需本地安装 psql 客户端）
pg_query() {
  docker exec infohub-postgres psql -U "$PG_USER" -d "$PG_DB" -t -A -c "$1" 2>/dev/null
}

# T2.1: 连接测试
if pg_query "SELECT 1;" >/dev/null 2>&1; then
  pass "T2.1: PostgreSQL 连接正常"
else
  fail "T2.1: PostgreSQL 连接失败"
fi

# T2.2: pgvector 扩展
VECTOR_EXT=$(pg_query "SELECT count(*) FROM pg_extension WHERE extname='vector';" || echo "0")
VECTOR_EXT=$(echo "$VECTOR_EXT" | tr -d '[:space:]')
if [ "$VECTOR_EXT" = "1" ]; then
  pass "T2.2: pgvector 扩展已安装"
else
  fail "T2.2: pgvector 扩展未安装 (got: $VECTOR_EXT)"
fi

# T2.3: 4个 Schema 存在
for schema in auth hub audio quota; do
  EXISTS=$(pg_query "SELECT count(*) FROM information_schema.schemata WHERE schema_name='$schema';" || echo "0")
  EXISTS=$(echo "$EXISTS" | tr -d '[:space:]')
  if [ "$EXISTS" = "1" ]; then
    pass "T2.3.$schema: schema '$schema' 存在"
  else
    fail "T2.3.$schema: schema '$schema' 不存在"
  fi
done

# T2.4: 核心表存在
for table in "auth.users" "auth.invite_codes" "hub.sources" "hub.items" "hub.filter_rules" "hub.ai_configs" "hub.insights" "hub.fetch_logs" "audio.tasks" "audio.usage_logs" "quota.plans" "quota.user_quotas"; do
  schema="${table%%.*}"
  tbl="${table##*.}"
  EXISTS=$(pg_query "SELECT count(*) FROM information_schema.tables WHERE table_schema='$schema' AND table_name='$tbl';" || echo "0")
  EXISTS=$(echo "$EXISTS" | tr -d '[:space:]')
  if [ "$EXISTS" = "1" ]; then
    pass "T2.4: 表 $table 存在"
  else
    fail "T2.4: 表 $table 不存在"
  fi
done

# T2.5: 默认配额计划
PLANS=$(pg_query "SELECT count(*) FROM quota.plans;" || echo "0")
PLANS=$(echo "$PLANS" | tr -d '[:space:]')
if [ "$PLANS" -ge 3 ] 2>/dev/null; then
  pass "T2.5: 默认配额计划已初始化 ($PLANS 条)"
else
  fail "T2.5: 默认配额计划不足 (got: $PLANS, expected >= 3)"
fi

# T2.6: hub.items 向量索引
IDX=$(pg_query "SELECT count(*) FROM pg_indexes WHERE tablename='items' AND indexname='idx_items_embedding';" || echo "0")
IDX=$(echo "$IDX" | tr -d '[:space:]')
if [ "$IDX" = "1" ]; then
  pass "T2.6: hub.items 向量索引 (hnsw) 存在"
else
  fail "T2.6: hub.items 向量索引不存在"
fi
echo ""

# ============================================================
# T3: Redis 连接
# ============================================================
log "--- T3: Redis ---"

REDIS_PONG=$(docker exec infohub-redis redis-cli ping 2>/dev/null || echo "ERROR")
if [ "$REDIS_PONG" = "PONG" ]; then
  pass "T3.1: Redis PING → PONG"
else
  fail "T3.1: Redis PING 失败 ($REDIS_PONG)"
fi
echo ""

# ============================================================
# T4: RSSHub
# ============================================================
log "--- T4: RSSHub ---"

# T4.1: 首页可达
RSSHUB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$RSSHUB_URL/" 2>/dev/null || echo "000")
if [ "$RSSHUB_STATUS" = "200" ]; then
  pass "T4.1: RSSHub 首页可达 (HTTP $RSSHUB_STATUS)"
else
  fail "T4.1: RSSHub 首页不可达 (HTTP $RSSHUB_STATUS)"
fi

# T4.2: 测试一个稳定路由（GitHub Releases）
RSSHUB_GH=$(curl -s -o /dev/null -w "%{http_code}" "$RSSHUB_URL/github/release/DIYgod/RSSHub" 2>/dev/null || echo "000")
if [ "$RSSHUB_GH" = "200" ]; then
  pass "T4.2: RSSHub GitHub 路由正常 (HTTP $RSSHUB_GH)"
else
  skip "T4.2: RSSHub GitHub 路由异常 (HTTP $RSSHUB_GH) — 可能网络问题"
fi
echo ""

# ============================================================
# T5: changedetection.io
# ============================================================
log "--- T5: changedetection.io ---"

CD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$CD_URL/" 2>/dev/null || echo "000")
if [ "$CD_STATUS" = "200" ] || [ "$CD_STATUS" = "302" ]; then
  pass "T5.1: changedetection Web UI 可达 (HTTP $CD_STATUS)"
else
  fail "T5.1: changedetection Web UI 不可达 (HTTP $CD_STATUS)"
fi
echo ""

# T6: Kill the Newsletter — 跳过（Phase 4 再集成）
echo ""

# ============================================================
# T7: ntfy
# ============================================================
log "--- T7: ntfy ---"

NTFY_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$NTFY_URL/v1/health" 2>/dev/null || echo "000")
if [ "$NTFY_HEALTH" = "200" ]; then
  pass "T7.1: ntfy 健康检查正常 (HTTP $NTFY_HEALTH)"
else
  fail "T7.1: ntfy 健康检查失败 (HTTP $NTFY_HEALTH)"
fi

# T7.2: 推送测试
NTFY_PUSH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$NTFY_URL/infohub-qa-test" \
  -H "Title: QA Test" \
  -d "Phase 0 QA 测试推送 - $(date '+%Y-%m-%d %H:%M:%S')" 2>/dev/null || echo "000")
if [ "$NTFY_PUSH" = "200" ]; then
  pass "T7.2: ntfy 推送成功 (HTTP $NTFY_PUSH)"
else
  fail "T7.2: ntfy 推送失败 (HTTP $NTFY_PUSH)"
fi
echo ""

# ============================================================
# 汇总
# ============================================================
TOTAL=$((PASS + FAIL + SKIP))
log "============================================"
log "Phase 0 QA 测试完成"
log "  总计: $TOTAL  通过: $PASS  失败: $FAIL  跳过: $SKIP"
log "============================================"

if [ "$FAIL" -gt 0 ]; then
  fail "存在 $FAIL 个失败项，请检查！"
  exit 1
else
  pass "所有测试通过！"
  exit 0
fi

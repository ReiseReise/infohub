#!/usr/bin/env bash
# ============================================================
# 信息中枢 v3 — 健康检查脚本
# 用法：bash scripts/health-check.sh
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; RESET='\033[0m'

ok()   { printf "%b[OK]%b %s\n" "$GREEN" "$RESET" "$*"; }
err()  { printf "%b[ERR]%b %s\n" "$RED" "$RESET" "$*"; }
info() { printf "%b[INFO]%b %s\n" "$CYAN" "$RESET" "$*"; }

ERRORS=0

info "信息中枢 v3 健康检查"
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "---"

# Docker 容器
for name in infohub-postgres infohub-redis infohub-rsshub infohub-changedetection infohub-ntfy; do
  status=$(docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null || echo "not_found")
  if [ "$status" = "running" ]; then
    ok "$name: running"
  else
    err "$name: $status"
    ERRORS=$((ERRORS+1))
  fi
done

# hub-engine（本地或 Docker）
HUB_URL="${HUB_ENGINE_URL:-http://localhost:3001}"
HUB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HUB_URL/health" 2>/dev/null || echo "000")
if [ "$HUB_STATUS" = "200" ]; then
  ok "hub-engine: healthy ($HUB_URL)"
else
  err "hub-engine: HTTP $HUB_STATUS ($HUB_URL)"
  ERRORS=$((ERRORS+1))
fi

# PostgreSQL
PG_OK=$(docker exec infohub-postgres psql -U postgres -d infohub -t -A -c "SELECT 1;" 2>/dev/null || echo "0")
PG_OK=$(echo "$PG_OK" | tr -d '[:space:]')
if [ "$PG_OK" = "1" ]; then
  ok "PostgreSQL: connected"
else
  err "PostgreSQL: connection failed"
  ERRORS=$((ERRORS+1))
fi

# Redis
REDIS_OK=$(docker exec infohub-redis redis-cli ping 2>/dev/null || echo "FAIL")
if [ "$REDIS_OK" = "PONG" ]; then
  ok "Redis: PONG"
else
  err "Redis: $REDIS_OK"
  ERRORS=$((ERRORS+1))
fi

# RSSHub
RSSHUB_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:1200/" 2>/dev/null || echo "000")
if [ "$RSSHUB_CODE" = "200" ]; then
  ok "RSSHub: reachable"
else
  err "RSSHub: HTTP $RSSHUB_CODE"
  ERRORS=$((ERRORS+1))
fi

# ntfy
NTFY_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8081/v1/health" 2>/dev/null || echo "000")
if [ "$NTFY_CODE" = "200" ]; then
  ok "ntfy: healthy"
else
  err "ntfy: HTTP $NTFY_CODE"
  ERRORS=$((ERRORS+1))
fi

echo "---"
if [ "$ERRORS" -gt 0 ]; then
  err "发现 $ERRORS 个问题！"
  exit 1
else
  ok "所有服务健康！"
  exit 0
fi

#!/usr/bin/env bash
# SEC-007: 清理 QA 测试账号及其关联数据。
#
# 背景：2026-07-13 曾清理 497 个僵尸账号，但生成端未修，十一天内重新累积 72 个。
# 本脚本负责"清存量"，配套的"堵生成端"在 qa/helpers/auth.sh 的 qa_auth_cleanup。
#
# 安全设计：
#   - 默认 dry-run，必须显式 --yes 才真正删除
#   - 只匹配 qa_%@example.com，并硬排除真人账号
#   - 全部删除包在单个事务里，任一步失败即整体回滚
#   - 按外键依赖顺序删除（13 张 NO ACTION 子表需手动删，7 张 CASCADE 自动）
#
# 用法：
#   bash scripts/dev/cleanup-qa-users.sh                 # dry-run，只报告
#   bash scripts/dev/cleanup-qa-users.sh --days 7        # 只清 7 天前的
#   bash scripts/dev/cleanup-qa-users.sh --yes           # 真正执行

set -euo pipefail

CONTAINER="${PG_CONTAINER:-infohub-postgres}"
DB="${PG_DB:-infohub}"
PG_USER="${PG_USER:-postgres}"
DAYS=""
APPLY="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) APPLY="true"; shift ;;
    --days) DAYS="${2:?--days needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

# 匹配条件：qa_ 前缀 + @example.com；硬排除真人账号，多一层保险
WHERE="email LIKE 'qa\_%@example.com'
       AND email NOT IN ('reise@infohub.local','admin@example.com','acceptance.admin@infohub.local','acceptance.user@infohub.local')"
if [[ -n "$DAYS" ]]; then
  WHERE="$WHERE AND created_at < now() - interval '$DAYS days'"
fi

psql_run() {
  docker exec -i "$CONTAINER" psql -U "$PG_USER" -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

echo "==> 目标容器 $CONTAINER / 库 $DB"
[[ -n "$DAYS" ]] && echo "==> 仅清理 $DAYS 天前创建的账号" || echo "==> 清理全部 QA 账号（未限定天数）"

TOTAL=$(psql_run -tAc "select count(*) from auth.users where $WHERE")
echo "==> 匹配到 $TOTAL 个 QA 账号"

if [[ "$TOTAL" -eq 0 ]]; then
  echo "==> 无需清理"
  exit 0
fi

echo "==> 关联数据统计："
psql_run -tAc "
with victims as (select id from auth.users where $WHERE)
select 'quota.user_quotas   ' , count(*) from quota.user_quotas where user_id in (select id from victims)
union all select 'hub.sources         ', count(*) from hub.sources where user_id in (select id from victims)
union all select 'hub.items           ', count(*) from hub.items where user_id in (select id from victims)
union all select 'hub.ai_usage_logs   ', count(*) from hub.ai_usage_logs where user_id in (select id from victims)
union all select 'audio.tasks         ', count(*) from audio.tasks where user_id in (select id from victims)
" | sed 's/|/ : /' | sed 's/^/    /'

if [[ "$APPLY" != "true" ]]; then
  echo
  echo "==> DRY-RUN，未做任何修改。确认无误后加 --yes 执行。"
  exit 0
fi

echo "==> 开始删除（单事务，失败即整体回滚）..."
psql_run <<SQL
begin;

create temp table victims on commit drop as
  select id from auth.users where $WHERE;

-- 按外键依赖顺序删除 NO ACTION 的子表；CASCADE 的子表随父表自动清理
delete from audio.usage_logs        where user_id in (select id from victims);
delete from audio.tasks             where user_id in (select id from victims);
delete from public.usage_logs       where user_id in (select id from victims);
delete from hub.ai_usage_logs       where user_id in (select id from victims);
delete from hub.ai_configs          where user_id in (select id from victims);
delete from hub.filter_rules        where user_id in (select id from victims);
delete from hub.insights            where user_id in (select id from victims);
delete from hub.quality_policies    where user_id in (select id from victims);
delete from hub.items               where user_id in (select id from victims);
delete from hub.sources             where user_id in (select id from victims);
delete from quota.user_quotas       where user_id in (select id from victims);
delete from auth.invite_codes       where created_by in (select id from victims)
                                        or used_by in (select id from victims);
delete from public.invite_codes     where created_by in (select id from victims);
delete from auth.users              where id in (select id from victims);

commit;
SQL

REMAIN=$(psql_run -tAc "select count(*) from auth.users where $WHERE")
echo "==> 完成。剩余匹配账号：$REMAIN"
psql_run -tAc "select count(*) from auth.users" | xargs -I{} echo "==> auth.users 现有总数：{}"

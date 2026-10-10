#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_FILE="${1:-}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-infohub-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-infohub-redis}"

cd "$ROOT_DIR"

for command_name in docker jq; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

db_scalar() {
  docker exec "$POSTGRES_CONTAINER" psql -U postgres -d infohub -At -c "$1" | tr -d '\r'
}

source "$ROOT_DIR/qa/helpers/redis-read.sh"

local_time="$(date '+%Y-%m-%d %H:%M:%S %Z')"
utc_time="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
configured_services="$(docker compose config --services | wc -l | tr -d ' ')"
running_services="$(docker compose ps --services --status running | wc -l | tr -d ' ')"
unhealthy_services="$(docker compose ps --format json | jq -s '[.[] | select(.Health != "" and .Health != "healthy")] | length')"

read -r active_sources due_sources unhealthy_sources <<<"$(db_scalar "
  select
    count(*) filter (where status = 'active'),
    count(*) filter (
      where status = 'active'
        and coalesce(auto_fetch_enabled, true)
        and (next_fetch_at is null or next_fetch_at <= now())
    ),
    count(*) filter (
      where status = 'active'
        and (coalesce(error_count, 0) > 0 or coalesce(last_error, '') <> '')
    )
  from hub.sources;
" | tr '|' ' ')"

read -r fetch_success fetch_error stale_fetch <<<"$(db_scalar "
  select
    count(*) filter (where status = 'success'),
    count(*) filter (where status = 'error'),
    count(*) filter (where finished_at is null and started_at < now() - interval '2 hours')
  from hub.fetch_logs
  where started_at >= now() - interval '24 hours';
" | tr '|' ' ')"

read -r items_24h processing_debt active_processing_debt observation_processing_debt inactive_processing_debt <<<"$(db_scalar "
  select
    count(items.*),
    count(*) filter (
      where items.processing_status in ('raw', 'scored', 'score_failed', 'summary_failed', 'translation_failed')
        and coalesce(items.is_filtered, false) = false
    ),
    count(*) filter (
      where items.processing_status in ('raw', 'scored', 'score_failed', 'summary_failed', 'translation_failed')
        and coalesce(items.is_filtered, false) = false
        and sources.status = 'active'
        and coalesce(sources.source_role, 'normal') not in ('radar', 'reference')
        and coalesce(sources.config->>'integrationStatus', 'active') not in ('shadow', 'paused', 'removed')
    ),
    count(*) filter (
      where items.processing_status in ('raw', 'scored', 'score_failed', 'summary_failed', 'translation_failed')
        and coalesce(items.is_filtered, false) = false
        and sources.status = 'active'
        and (
          coalesce(sources.source_role, 'normal') in ('radar', 'reference')
          or coalesce(sources.config->>'integrationStatus', 'active') in ('shadow', 'paused', 'removed')
        )
    ),
    count(*) filter (
      where items.processing_status in ('raw', 'scored', 'score_failed', 'summary_failed', 'translation_failed')
        and coalesce(items.is_filtered, false) = false
        and sources.status <> 'active'
    )
  from hub.items items
  join hub.sources sources on sources.id = items.source_id
  where items.fetched_at >= now() - interval '24 hours';
" | tr '|' ' ')"

read -r ai_success ai_error <<<"$(db_scalar "
  select
    count(*) filter (where status = 'success'),
    count(*) filter (where status = 'error')
  from hub.ai_usage_logs
  where created_at >= now() - interval '24 hours';
" | tr '|' ' ')"

read -r daily_full daily_degraded sparse_full_reports template_cover_reports latest_main_report latest_source_report <<<"$(db_scalar "
  select
    count(*) filter (where payload->>'qualityStatus' = 'full'),
    count(*) filter (where payload->>'qualityStatus' = 'degraded'),
    count(*) filter (
      where payload->>'qualityStatus' = 'full'
        and jsonb_array_length(coalesce(payload->'editorialMaterials', '[]'::jsonb)) <
          case when type like 'daily_source_%' then 3 else 5 end
    ),
    count(*) filter (
      where coalesce(payload->'coverJudgement'->>'summary', '') like '%阅读时先核对头部文章%'
    ),
    coalesce((max(date) filter (where type = 'daily'))::text, 'none'),
    coalesce((max(date) filter (where type like 'daily_source_%'))::text, 'none')
  from hub.insights
  where type like 'daily%'
    and date >= current_date - 2;
" | tr '|' ' ')"

read -r audio_done audio_failed_total audio_failed_24h stale_audio <<<"$(db_scalar "
  select
    count(*) filter (where status = 'done'),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status = 'failed' and updated_at >= now() - interval '24 hours'),
    count(*) filter (
      where status in ('uploading', 'transcribing', 'summarizing', 'generating')
        and updated_at < now() - interval '2 hours'
    )
  from public.audio_tasks;
" | tr '|' ' ')"

queue_rows=""
queue_backlog=0
queue_failed=0
queue_failed_recent=0
failure_cutoff_ms="$(( $(date +%s) * 1000 - 24 * 60 * 60 * 1000 ))"
for queue_name in fetch process daily-report item-translation; do
  wait_count="$(redis_count "bull:${queue_name}:wait")"
  active_count="$(redis_count "bull:${queue_name}:active")"
  delayed_count="$(redis_count "bull:${queue_name}:delayed")"
  prioritized_count="$(redis_count "bull:${queue_name}:prioritized")"
  failed_count="$(redis_count "bull:${queue_name}:failed")"
  recent_failed_count="$(redis_recent_failure_count "bull:${queue_name}:failed" "$failure_cutoff_ms")"
  completed_count="$(redis_count "bull:${queue_name}:completed")"
  queue_backlog=$((queue_backlog + wait_count + active_count + delayed_count + prioritized_count))
  queue_failed=$((queue_failed + failed_count))
  queue_failed_recent=$((queue_failed_recent + recent_failed_count))
  queue_rows+="| ${queue_name} | ${wait_count} | ${active_count} | ${delayed_count} | ${prioritized_count} | ${recent_failed_count} | ${failed_count} | ${completed_count} |"$'\n'
done

snapshot_status="PASS"
if ((
  running_services != configured_services
  || unhealthy_services > 0
  || unhealthy_sources > 0
  || stale_fetch > 0
  || stale_audio > 0
  || queue_failed_recent > 0
  || ai_error * 10 > ai_success + ai_error
  || fetch_error * 10 > fetch_success + fetch_error
  || sparse_full_reports > 0
  || template_cover_reports > 0
)); then
  snapshot_status="REVIEW"
fi

service_rows="$(docker compose ps --format json | jq -s -r 'sort_by(.Service)[] | "| \(.Service) | \(.State) | \(if .Health == "" then "n/a" else .Health end) | \(.RunningFor) |"')"

render_snapshot() {
  cat <<EOF
## ${local_time}

- 机器时间：${utc_time}
- 快照判断：**${snapshot_status}**
- 说明：单次快照同时检查运行积压和日报质量债；ENG-009 必须比较 72 小时内多次快照后才能完成。

### 服务状态

| 服务 | 状态 | 健康 | 创建距今（非连续运行时间） |
|---|---|---|---|
${service_rows}

汇总：配置 ${configured_services} 个服务，运行 ${running_services} 个，异常健康检查 ${unhealthy_services} 个。

### 队列状态

| 队列 | 等待 | 执行中 | 延迟 | 优先 | 24h 新失败 | 失败保留 | 完成保留 |
|---|---:|---:|---:|---:|---:|---:|---:|
${queue_rows}
当前待处理总量：${queue_backlog}；24 小时新增失败：${queue_failed_recent}；历史失败保留总量：${queue_failed}。历史保留只用于审计，不单独触发 REVIEW。

### 24 小时数据

| 指标 | 当前值 |
|---|---:|
| 活跃来源 | ${active_sources} |
| 到期待抓来源 | ${due_sources} |
| 来源健康异常 | ${unhealthy_sources} |
| 抓取成功 / 失败 | ${fetch_success} / ${fetch_error} |
| 超过 2 小时未结束的抓取 | ${stale_fetch} |
| 新抓条目 | ${items_24h} |
| 当前处理债务（全部） | ${processing_debt} |
| 当前处理债务（正式活跃来源） | ${active_processing_debt} |
| 当前处理债务（shadow / radar 观察源） | ${observation_processing_debt} |
| 当前处理债务（暂停/归档来源） | ${inactive_processing_debt} |
| AI 成功 / 失败 | ${ai_success} / ${ai_error} |
| 最近 3 日 full / degraded 日报 | ${daily_full} / ${daily_degraded} |
| 证据不足却标为 full 的日报 | ${sparse_full_reports} |
| 命中旧封面模板的日报 | ${template_cover_reports} |
| 最新主日报 / 来源日报日期 | ${latest_main_report} / ${latest_source_report} |
| 音频完成 / 历史失败累计 | ${audio_done} / ${audio_failed_total} |
| 近 24 小时新增音频失败 | ${audio_failed_24h} |
| 超过 2 小时未结束的音频任务 | ${stale_audio} |

### 日报质量判断

- 证据不足却标为 full：主日报少于 5 条、来源日报少于 3 条编辑素材，却仍保存为高质量完成。
- 命中旧封面模板：历史封面仍包含固定的“阅读时先核对头部文章”话术。
- 两项任一大于 0 时，快照标为 REVIEW；新质量门禁只作用于后续生成，不回写历史日报。

EOF
}

if [[ -n "$OUTPUT_FILE" ]]; then
  mkdir -p "$(dirname "$OUTPUT_FILE")"
  if [[ ! -f "$OUTPUT_FILE" ]]; then
    cat >"$OUTPUT_FILE" <<EOF
---
title: 信息中枢 V3 72 小时运行观察
type: qa-runtime-observation
status: active
version: 1.0
owner: AIReise
created: $(date '+%Y-%m-%d')
updated: $(date '+%Y-%m-%d')
tags: [qa, runtime, observation]
---

# 信息中枢 V3 72 小时运行观察

> 由 qa/p0/capture_runtime_observation.sh 追加。只有起点、中间和终点快照均无持续积压，并完成跨日人工复核，才能勾选 ENG-009。

EOF
  fi
  render_snapshot >>"$OUTPUT_FILE"
  printf 'Runtime snapshot appended to %s\n' "$OUTPUT_FILE"
else
  render_snapshot
fi

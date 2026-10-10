#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_CONTAINER="${DB_CONTAINER:-infohub-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-infohub-redis}"
CONFIRM_TOKEN="RESET-INFOHUB-V3-20260713"
MODE="dry-run"

usage() {
  cat <<'EOF'
Usage:
  scripts/portable/reset-reading-data.sh
  scripts/portable/reset-reading-data.sh --execute --confirm RESET-INFOHUB-V3-20260713

Default mode is read-only. The execute mode clears the reading and daily-report
data plane while preserving the Reise and acceptance-admin accounts, their
configuration, audio assets, Dibao, changedetection, ntfy, and source-registry
files. Redis queue/cache state is flushed only in execute mode.
EOF
}

while (($# > 0)); do
  case "$1" in
    --execute)
      MODE="execute"
      shift
      ;;
    --confirm)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      PROVIDED_CONFIRM="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage
      exit 2
      ;;
  esac
done

if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  printf 'PostgreSQL container not found: %s\n' "$DB_CONTAINER" >&2
  exit 1
fi

read_sql() {
  docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d infohub "$@"
}

print_scope() {
  cat <<'EOF'

Preserved:
  - auth users: reise@infohub.local, acceptance.admin@infohub.local
  - their user settings, AI configs, scoring skills, filter rules, quality policies
  - audio tasks/uploads, Dibao, changedetection, ntfy, knowledge files
  - docs/source-registry and encrypted recovery package

Deleted on execute:
  - all hub sources, items, fetch logs, AI usage logs, daily reports/insights
  - item scores, quality checks, feedback, reading assets, preference profiles
  - retention history and stale Redis queue/cache state
  - QA/shadow users and configuration owned only by those users
EOF
}

print_scope

read_sql -P pager=off <<'SQL'
WITH kept_users AS (
  SELECT id
  FROM auth.users
  WHERE lower(email) IN ('reise@infohub.local', 'acceptance.admin@infohub.local')
), counts AS (
  SELECT 'auth.users (QA/shadow)' AS object, count(*)::bigint AS rows
  FROM auth.users WHERE id NOT IN (SELECT id FROM kept_users)
  UNION ALL SELECT 'hub.sources', count(*) FROM hub.sources
  UNION ALL SELECT 'hub.items', count(*) FROM hub.items
  UNION ALL SELECT 'hub.fetch_logs', count(*) FROM hub.fetch_logs
  UNION ALL SELECT 'hub.ai_usage_logs', count(*) FROM hub.ai_usage_logs
  UNION ALL SELECT 'hub.insights', count(*) FROM hub.insights
  UNION ALL SELECT 'hub.item_score_breakdowns', count(*) FROM hub.item_score_breakdowns
  UNION ALL SELECT 'hub.item_quality_checks', count(*) FROM hub.item_quality_checks
  UNION ALL SELECT 'hub.item_feedback', count(*) FROM hub.item_feedback
  UNION ALL SELECT 'hub.item_reading_assets', count(*) FROM hub.item_reading_assets
  UNION ALL SELECT 'hub.user_preference_profiles', count(*) FROM hub.user_preference_profiles
  UNION ALL SELECT 'hub.retention_runs', count(*) FROM hub.retention_runs
  UNION ALL SELECT 'QA filter rules', count(*) FROM hub.filter_rules WHERE user_id NOT IN (SELECT id FROM kept_users)
  UNION ALL SELECT 'QA AI configs', count(*) FROM hub.ai_configs WHERE user_id NOT IN (SELECT id FROM kept_users)
  UNION ALL SELECT 'QA scoring skills', count(*) FROM hub.scoring_skills WHERE user_id NOT IN (SELECT id FROM kept_users)
  UNION ALL SELECT 'QA quality policies', count(*) FROM hub.quality_policies WHERE user_id NOT IN (SELECT id FROM kept_users)
  UNION ALL SELECT 'QA audio tasks', count(*) FROM audio.tasks WHERE user_id NOT IN (SELECT id FROM kept_users)
  UNION ALL SELECT 'QA audio usage logs', count(*) FROM audio.usage_logs WHERE user_id NOT IN (SELECT id FROM kept_users)
  UNION ALL SELECT 'QA user quotas', count(*) FROM quota.user_quotas WHERE user_id NOT IN (SELECT id FROM kept_users)
)
SELECT object AS "dry-run object", rows AS "rows to delete"
FROM counts
ORDER BY object;

SELECT email AS "preserved account", role
FROM auth.users
WHERE lower(email) IN ('reise@infohub.local', 'acceptance.admin@infohub.local')
ORDER BY email;
SQL

if [[ "$MODE" != "execute" ]]; then
  printf '\nDry-run only. No data was changed.\n'
  exit 0
fi

if [[ "${PROVIDED_CONFIRM:-}" != "$CONFIRM_TOKEN" ]]; then
  printf '\nRefusing destructive reset. Required confirmation token: %s\n' "$CONFIRM_TOKEN" >&2
  exit 3
fi

cd "$ROOT_DIR"
docker compose stop hub-engine audio-service audio-worker audio-worker-asr

restart_services() {
  docker compose up -d hub-engine audio-service audio-worker audio-worker-asr >/dev/null
}
trap restart_services EXIT

read_sql <<'SQL'
BEGIN;

CREATE TEMP TABLE kept_users ON COMMIT DROP AS
SELECT id
FROM auth.users
WHERE lower(email) IN ('reise@infohub.local', 'acceptance.admin@infohub.local');

DO $$
BEGIN
  IF (SELECT count(*) FROM kept_users) <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two preserved accounts';
  END IF;
END $$;

DELETE FROM auth.invite_codes;
DELETE FROM hub.item_feedback;
DELETE FROM hub.item_quality_checks;
DELETE FROM hub.item_reading_assets;
DELETE FROM hub.item_score_breakdowns;
DELETE FROM hub.fetch_logs;
DELETE FROM hub.ai_usage_logs;
DELETE FROM hub.insights;
DELETE FROM hub.user_preference_profiles;
DELETE FROM hub.retention_runs;
DELETE FROM hub.items;
DELETE FROM hub.sources;

DELETE FROM audio.usage_logs
WHERE task_id IN (
  SELECT id FROM audio.tasks WHERE user_id NOT IN (SELECT id FROM kept_users)
) OR user_id NOT IN (SELECT id FROM kept_users);
DELETE FROM audio.tasks WHERE user_id NOT IN (SELECT id FROM kept_users);

DELETE FROM hub.filter_rules WHERE user_id NOT IN (SELECT id FROM kept_users);
DELETE FROM hub.ai_configs WHERE user_id NOT IN (SELECT id FROM kept_users);
DELETE FROM hub.quality_policies WHERE user_id NOT IN (SELECT id FROM kept_users);
DELETE FROM hub.scoring_skills WHERE user_id NOT IN (SELECT id FROM kept_users);
DELETE FROM hub.user_settings WHERE user_id NOT IN (SELECT id FROM kept_users);
DELETE FROM quota.user_quotas WHERE user_id NOT IN (SELECT id FROM kept_users);
DELETE FROM auth.users WHERE id NOT IN (SELECT id FROM kept_users);

COMMIT;
SQL

docker exec "$REDIS_CONTAINER" redis-cli FLUSHDB >/dev/null

printf '\nReading data reset completed. Services are restarting.\n'

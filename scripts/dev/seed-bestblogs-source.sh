#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
  set +a
fi

ADMIN_EMAIL="${ACCEPTANCE_ADMIN_EMAIL:-acceptance.admin@infohub.local}"

docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d infohub -v admin_email="$ADMIN_EMAIL" <<'SQL'
DO $$
DECLARE
  con_name TEXT;
BEGIN
  FOR con_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'hub'
      AND t.relname = 'sources'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%collector_type%'
  LOOP
    EXECUTE format('ALTER TABLE hub.sources DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

ALTER TABLE hub.sources
  ADD CONSTRAINT sources_collector_type_check CHECK (collector_type IN ('rss', 'rsshub', 'changedetection', 'newsletter', 'youtube', 'custom', 'webpage', 'webpage_index'));

DO $$
DECLARE
  con_name TEXT;
BEGIN
  FOR con_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'hub'
      AND t.relname = 'sources'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%source_type%'
  LOOP
    EXECUTE format('ALTER TABLE hub.sources DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

ALTER TABLE hub.sources
  ADD CONSTRAINT sources_source_type_check CHECK (source_type IN ('rss', 'podcast', 'audio', 'rsshub', 'webpage', 'newsletter', 'custom', 'email', 'curated_index'));

WITH target_user AS (
  SELECT id AS user_id FROM auth.users WHERE email = :'admin_email' LIMIT 1
),
seed_source AS (
  SELECT
    'BestBlogs Daily Brief'::text AS name,
    'https://www.bestblogs.dev/en/explore/brief'::text AS url,
    'curated_index'::text AS source_type,
    'webpage_index'::text AS collector_type,
    'media'::text AS source_kind,
    'normal'::text AS source_role,
    'A'::text AS source_tier,
    1.08::real AS authority_weight,
    'smart'::text AS processing_profile,
    82::int AS trust_score,
    22::int AS noise_score,
    4::int AS priority,
    1440::int AS fetch_interval,
    ARRAY['bestblogs','daily-brief','curated-index','blogs','aihot']::text[] AS tags,
    ARRAY['认知升级','技术能力']::text[] AS growth_axes
),
updated AS (
  UPDATE hub.sources s
  SET
    source_type = seed_source.source_type,
    collector_type = seed_source.collector_type,
    source_kind = seed_source.source_kind,
    source_role = seed_source.source_role,
    source_tier = seed_source.source_tier,
    authority_weight = seed_source.authority_weight,
    processing_profile = seed_source.processing_profile,
    trust_score = seed_source.trust_score,
    noise_score = seed_source.noise_score,
    config = jsonb_build_object(
      'url', seed_source.url,
      'renderMode', 'browser-assist',
      'indexKind', 'bestblogs_daily_brief',
      'itemMode', 'article_cards',
      'locale', 'zh'
    ),
    category = 'AI',
    tags = to_jsonb(seed_source.tags),
    growth_axes = to_jsonb(seed_source.growth_axes),
    priority = seed_source.priority,
    fetch_interval = seed_source.fetch_interval,
    auto_fetch_enabled = true,
    status = 'active',
    next_fetch_at = now(),
    last_outcome = coalesce(s.last_outcome, 'scheduled'),
    updated_at = now()
  FROM target_user, seed_source
  WHERE s.user_id = target_user.user_id
    AND s.name = seed_source.name
  RETURNING s.id
)
INSERT INTO hub.sources (
  user_id,
  name,
  source_type,
  collector_type,
  source_kind,
  source_role,
  source_tier,
  authority_weight,
  processing_profile,
  trust_score,
  noise_score,
  config,
  category,
  tags,
  growth_axes,
  upgrade_rules,
  priority,
  fetch_interval,
  auto_fetch_enabled,
  auto_transcribe,
  status,
  next_fetch_at,
  last_outcome
)
SELECT
  target_user.user_id,
  seed_source.name,
  seed_source.source_type,
  seed_source.collector_type,
  seed_source.source_kind,
  seed_source.source_role,
  seed_source.source_tier,
  seed_source.authority_weight,
  seed_source.processing_profile,
  seed_source.trust_score,
  seed_source.noise_score,
  jsonb_build_object(
    'url', seed_source.url,
    'renderMode', 'browser-assist',
    'indexKind', 'bestblogs_daily_brief',
    'itemMode', 'article_cards',
    'locale', 'zh'
  ),
  'AI',
  to_jsonb(seed_source.tags),
  to_jsonb(seed_source.growth_axes),
  '{}'::jsonb,
  seed_source.priority,
  seed_source.fetch_interval,
  true,
  false,
  'active',
  now(),
  'scheduled'
FROM target_user, seed_source
WHERE NOT EXISTS (
  SELECT 1 FROM hub.sources s
  WHERE s.user_id = target_user.user_id
    AND s.name = seed_source.name
);
SQL

echo "Seeded BestBlogs Daily Brief source for $ADMIN_EMAIL"

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

docker compose exec -T postgres psql -U postgres -d infohub -v admin_email="$ADMIN_EMAIL" <<'SQL'
WITH target_user AS (
  SELECT id AS user_id FROM auth.users WHERE email = :'admin_email' LIMIT 1
),
seed_sources AS (
  SELECT *
  FROM (
    VALUES
      (
        'Anthropic Newsroom',
        'https://www.anthropic.com/news',
        'official',
        'S',
        1.35::real,
        96,
        6,
        5,
        30,
        'full',
        ARRAY['aihot','anthropic','claude','official','model-release']::text[],
        ARRAY['技术能力','认知升级']::text[]
      ),
      (
        'Claude Platform Release Notes',
        'https://platform.claude.com/docs/en/release-notes/overview',
        'official',
        'S',
        1.30::real,
        94,
        8,
        5,
        45,
        'full',
        ARRAY['aihot','anthropic','claude','official','release-notes']::text[],
        ARRAY['技术能力','认知升级']::text[]
      ),
      (
        'The Verge AI',
        'https://www.theverge.com/ai-artificial-intelligence',
        'media',
        'A',
        1.10::real,
        82,
        24,
        4,
        60,
        'smart',
        ARRAY['aihot','media','ai-news','anthropic-watch']::text[],
        ARRAY['认知升级','技术能力']::text[]
      ),
      (
        'TechCrunch AI',
        'https://techcrunch.com/category/artificial-intelligence/',
        'media',
        'A',
        1.05::real,
        80,
        28,
        4,
        60,
        'smart',
        ARRAY['aihot','media','ai-news','startup-watch']::text[],
        ARRAY['认知升级','商业判断']::text[]
      ),
      (
        'Business Insider AI',
        'https://www.businessinsider.com/artificial-intelligence',
        'media',
        'A',
        1.00::real,
        76,
        34,
        3,
        90,
        'smart',
        ARRAY['aihot','media','ai-news','business-watch']::text[],
        ARRAY['认知升级','商业判断']::text[]
      )
  ) AS t(name, url, source_kind, source_tier, authority_weight, trust_score, noise_score, priority, fetch_interval, processing_profile, tags, growth_axes)
),
updated AS (
  UPDATE hub.sources s
  SET
    source_type = CASE WHEN seed_sources.name = 'Anthropic Newsroom' THEN 'curated_index' ELSE 'webpage' END,
    collector_type = CASE WHEN seed_sources.name = 'Anthropic Newsroom' THEN 'webpage_index' ELSE 'webpage' END,
    source_kind = seed_sources.source_kind,
    source_role = CASE WHEN seed_sources.name = 'Anthropic Newsroom' THEN 'normal' ELSE 'monitor' END,
    source_tier = seed_sources.source_tier,
    authority_weight = seed_sources.authority_weight,
    processing_profile = seed_sources.processing_profile,
    trust_score = seed_sources.trust_score,
    noise_score = seed_sources.noise_score,
    config = CASE
      WHEN seed_sources.name = 'Anthropic Newsroom'
        THEN jsonb_build_object('url', seed_sources.url, 'renderMode', 'auto', 'indexKind', 'anthropic_news', 'itemMode', 'news_cards')
      ELSE jsonb_build_object('url', seed_sources.url, 'renderMode', 'auto', 'monitorMode', 'webpage')
    END,
    category = 'AI',
    tags = to_jsonb(seed_sources.tags),
    growth_axes = to_jsonb(seed_sources.growth_axes),
    priority = seed_sources.priority,
    fetch_interval = seed_sources.fetch_interval,
    auto_fetch_enabled = true,
    status = 'active',
    next_fetch_at = now(),
    last_outcome = coalesce(s.last_outcome, 'scheduled'),
    updated_at = now()
  FROM target_user, seed_sources
  WHERE s.user_id = target_user.user_id
    AND s.name = seed_sources.name
  RETURNING s.name
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
  seed_sources.name,
  CASE WHEN seed_sources.name = 'Anthropic Newsroom' THEN 'curated_index' ELSE 'webpage' END,
  CASE WHEN seed_sources.name = 'Anthropic Newsroom' THEN 'webpage_index' ELSE 'webpage' END,
  seed_sources.source_kind,
  CASE WHEN seed_sources.name = 'Anthropic Newsroom' THEN 'normal' ELSE 'monitor' END,
  seed_sources.source_tier,
  seed_sources.authority_weight,
  seed_sources.processing_profile,
  seed_sources.trust_score,
  seed_sources.noise_score,
  CASE
    WHEN seed_sources.name = 'Anthropic Newsroom'
      THEN jsonb_build_object('url', seed_sources.url, 'renderMode', 'auto', 'indexKind', 'anthropic_news', 'itemMode', 'news_cards')
    ELSE jsonb_build_object('url', seed_sources.url, 'renderMode', 'auto', 'monitorMode', 'webpage')
  END,
  'AI',
  to_jsonb(seed_sources.tags),
  to_jsonb(seed_sources.growth_axes),
  '{}'::jsonb,
  seed_sources.priority,
  seed_sources.fetch_interval,
  true,
  false,
  'active',
  now(),
  'scheduled'
FROM target_user, seed_sources
WHERE NOT EXISTS (
  SELECT 1 FROM hub.sources s
  WHERE s.user_id = target_user.user_id
    AND s.name = seed_sources.name
);
SQL

echo "Seeded Claude/Anthropic monitoring sources for $ADMIN_EMAIL"

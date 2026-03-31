#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

docker compose exec -T postgres psql -U postgres -d infohub <<'SQL'
ALTER TABLE hub.filter_rules
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE hub.filter_rules
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'user';

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
      AND t.relname = 'filter_rules'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%scope%'
  LOOP
    EXECUTE format('ALTER TABLE hub.filter_rules DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

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
      AND t.relname = 'filter_rules'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE hub.filter_rules DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

ALTER TABLE hub.filter_rules
  ADD CONSTRAINT filter_rules_type_check CHECK (
    type IN (
      'keyword_whitelist',
      'keyword_blacklist',
      'source_priority',
      'time_decay',
      'author_filter',
      'length_filter',
      'language_filter',
      'ai_score_filter'
    )
  );

ALTER TABLE hub.filter_rules
  ADD CONSTRAINT filter_rules_scope_check CHECK (scope IN ('global', 'user'));

CREATE INDEX IF NOT EXISTS idx_rules_scope ON hub.filter_rules (scope, enabled);

ALTER TABLE hub.ai_configs
  ADD COLUMN IF NOT EXISTS prompt_template_id TEXT,
  ADD COLUMN IF NOT EXISTS model_config_id TEXT;

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
      AND t.relname = 'ai_configs'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE hub.ai_configs DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

ALTER TABLE hub.ai_configs
  ADD CONSTRAINT ai_configs_type_check CHECK (type IN ('scoring', 'summary', 'translation', 'trends', 'extraction', 'daily_report'));

CREATE INDEX IF NOT EXISTS idx_ai_configs_refs ON hub.ai_configs (model_config_id, prompt_template_id);

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
  ADD CONSTRAINT sources_collector_type_check CHECK (collector_type IN ('rss', 'rsshub', 'changedetection', 'newsletter', 'youtube', 'custom', 'webpage'));

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT c.conname INTO fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'hub'
    AND t.relname = 'fetch_logs'
    AND c.contype = 'f'
    AND pg_get_constraintdef(c.oid) ILIKE '%source_id%';

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE hub.fetch_logs DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE hub.fetch_logs
  ADD CONSTRAINT fetch_logs_source_id_fkey
  FOREIGN KEY (source_id) REFERENCES hub.sources(id) ON DELETE SET NULL;
SQL

echo "P0 schema updates applied."

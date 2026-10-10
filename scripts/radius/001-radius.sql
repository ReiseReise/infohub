-- Additive migration. Run against an isolated database first; never auto-run at startup.
BEGIN;
ALTER TABLE hub.user_settings ADD COLUMN IF NOT EXISTS radius_topics jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS hub.radius_sync (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  started_at timestamptz,
  completed_at timestamptz,
  document_count integer NOT NULL DEFAULT 0,
  task_id bigint,
  error text
);
INSERT INTO hub.radius_sync(id) VALUES(true) ON CONFLICT DO NOTHING;
COMMIT;

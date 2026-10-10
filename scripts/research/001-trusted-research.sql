BEGIN;
CREATE TABLE IF NOT EXISTS hub.research_runs (
 id uuid PRIMARY KEY, request_key text NOT NULL UNIQUE, requested_by uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('daily','topic')), question text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','paused','cancelled','review','completed','failed')),
 policy jsonb NOT NULL, input jsonb NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 1,
 budget_micros bigint NOT NULL DEFAULT 10000000 CHECK (budget_micros BETWEEN 0 AND 10000000),
 spent_micros bigint NOT NULL DEFAULT 0 CHECK (spent_micros >= 0), reserved_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
 reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (spent_micros + reserved_micros <= budget_micros)
);
CREATE TABLE IF NOT EXISTS hub.research_events (
 id uuid PRIMARY KEY, event_key text NOT NULL UNIQUE, title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hub.research_sources (
 id uuid PRIMARY KEY, item_id uuid, url text NOT NULL, title text NOT NULL, author text,
 published_at timestamptz, captured_at timestamptz NOT NULL DEFAULT now(),
 content_hash text NOT NULL, body text NOT NULL, origin text NOT NULL CHECK (origin IN ('collected','web','fixture')),
 UNIQUE(url,content_hash)
);
CREATE TABLE IF NOT EXISTS hub.research_run_sources (
 run_id uuid NOT NULL REFERENCES hub.research_runs(id), source_id uuid NOT NULL REFERENCES hub.research_sources(id),
 event_id uuid REFERENCES hub.research_events(id), PRIMARY KEY(run_id,source_id)
);
CREATE TABLE IF NOT EXISTS hub.research_steps (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES hub.research_runs(id), step_key text NOT NULL,
 stage text NOT NULL CHECK (stage IN ('research','verify','edit','final_verify')),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','done','failed','review','paused','cancelled')),
 revision integer NOT NULL DEFAULT 1, attempt integer NOT NULL DEFAULT 0,
 lease_token uuid, lease_until timestamptz, input jsonb NOT NULL DEFAULT '{}', output jsonb, error text,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,step_key)
);
ALTER TABLE hub.research_steps DROP CONSTRAINT IF EXISTS research_steps_state_check;
ALTER TABLE hub.research_steps ADD CONSTRAINT research_steps_state_check CHECK(state IN ('pending','running','done','failed','review','paused','cancelled'));
CREATE TABLE IF NOT EXISTS hub.research_citations (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES hub.research_runs(id), source_id uuid NOT NULL REFERENCES hub.research_sources(id),
 quote text NOT NULL, start_offset integer NOT NULL CHECK(start_offset >= 0), end_offset integer NOT NULL,
 CHECK(end_offset > start_offset), UNIQUE(run_id,source_id,start_offset,end_offset)
);
CREATE TABLE IF NOT EXISTS hub.research_drafts (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES hub.research_runs(id), step_id uuid REFERENCES hub.research_steps(id),
 version integer NOT NULL, origin text NOT NULL CHECK(origin IN ('model','human')),
 quality text NOT NULL CHECK(quality IN ('candidate','review','verified')), payload jsonb NOT NULL,
 markdown text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,version)
);
CREATE TABLE IF NOT EXISTS hub.research_guidance (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES hub.research_runs(id), request_key text NOT NULL,
 content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,request_key)
);
CREATE TABLE IF NOT EXISTS hub.research_run_log (
 seq bigserial PRIMARY KEY, run_id uuid NOT NULL REFERENCES hub.research_runs(id),
 type text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS research_run_log_lookup ON hub.research_run_log(run_id,seq);
CREATE TABLE IF NOT EXISTS hub.research_calls (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES hub.research_runs(id), step_id uuid NOT NULL REFERENCES hub.research_steps(id),
 revision integer NOT NULL, kind text NOT NULL, state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','settled','uncertain')),
 reserved_micros bigint NOT NULL CHECK(reserved_micros >= 0), actual_micros bigint,
 metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
-- A snapshot is immutable, including attribution and time metadata. No cascading deletion from the feed.
CREATE OR REPLACE FUNCTION hub.reject_research_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'research evidence and draft versions are immutable'; END $$;
DROP TRIGGER IF EXISTS research_sources_immutable ON hub.research_sources;
CREATE TRIGGER research_sources_immutable BEFORE UPDATE OR DELETE ON hub.research_sources FOR EACH ROW EXECUTE FUNCTION hub.reject_research_snapshot_mutation();
DROP TRIGGER IF EXISTS research_citations_immutable ON hub.research_citations;
CREATE TRIGGER research_citations_immutable BEFORE UPDATE OR DELETE ON hub.research_citations FOR EACH ROW EXECUTE FUNCTION hub.reject_research_snapshot_mutation();
DROP TRIGGER IF EXISTS research_drafts_immutable ON hub.research_drafts;
CREATE TRIGGER research_drafts_immutable BEFORE UPDATE OR DELETE ON hub.research_drafts FOR EACH ROW EXECUTE FUNCTION hub.reject_research_snapshot_mutation();
COMMIT;

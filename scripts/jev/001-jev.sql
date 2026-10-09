BEGIN;
CREATE TABLE IF NOT EXISTS hub.jev_control (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), stopped boolean NOT NULL DEFAULT true,
 modes jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO hub.jev_control(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS hub.jev_budget (
 id text PRIMARY KEY CHECK(id='jev-20260922'), limit_micros bigint NOT NULL DEFAULT 1000000 CHECK(limit_micros=1000000),
 spent_micros bigint NOT NULL DEFAULT 0 CHECK(spent_micros>=0), reserved_micros bigint NOT NULL DEFAULT 0 CHECK(reserved_micros>=0),
 CHECK(spent_micros+reserved_micros<=limit_micros)
);
INSERT INTO hub.jev_budget(id) VALUES('jev-20260922') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS hub.jev_decisions (
 id text PRIMARY KEY, scene text NOT NULL, target_id text NOT NULL, peer_id text,
 revision text NOT NULL, model text NOT NULL, question_version text NOT NULL, language text NOT NULL,
 public_basis text NOT NULL, status text NOT NULL, reason text, suggestion jsonb,
 actual_action text NOT NULL DEFAULT 'original', reserved_micros bigint NOT NULL DEFAULT 0,
 cost_micros bigint, input_tokens integer, latency_ms integer, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS jev_decisions_target ON hub.jev_decisions(target_id,created_at DESC);
CREATE TABLE IF NOT EXISTS hub.jev_feedback (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, decision_id text NOT NULL REFERENCES hub.jev_decisions(id),
 verdict text NOT NULL CHECK(verdict IN ('agree','disagree','important_miss')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hub.jev_acceptance (
 scene text NOT NULL, language text NOT NULL, evidence text NOT NULL, approved boolean NOT NULL DEFAULT false,
 PRIMARY KEY(scene,language)
);
COMMIT;

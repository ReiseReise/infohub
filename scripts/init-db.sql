-- ============================================================
-- 信息中枢 v3 — 数据库初始化脚本
-- 由 docker-entrypoint-initdb.d 自动执行
-- ============================================================

-- 启用扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- Schema: auth（用户与权限）
-- ============================================================
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth.invite_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  max_uses    INT DEFAULT 1,
  use_count   INT DEFAULT 0,
  used_by     UUID REFERENCES auth.users(id),
  used_at     TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Schema: hub（信息中枢核心）
-- ============================================================
CREATE SCHEMA IF NOT EXISTS hub;

-- 信源表
CREATE TABLE hub.sources (
  id               SERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES auth.users(id),
  name             TEXT NOT NULL,
  source_type      TEXT NOT NULL CHECK (source_type IN ('rss', 'podcast', 'audio', 'rsshub', 'webpage', 'newsletter', 'custom')),
  collector_type   TEXT NOT NULL DEFAULT 'rss' CHECK (collector_type IN ('rss', 'rsshub', 'changedetection', 'newsletter', 'youtube', 'custom', 'webpage')),
  source_role      TEXT NOT NULL DEFAULT 'normal',
  source_tier      TEXT NOT NULL DEFAULT 'B',
  processing_profile TEXT NOT NULL DEFAULT 'brief',
  trust_score      INT NOT NULL DEFAULT 60,
  noise_score      INT NOT NULL DEFAULT 40,
  growth_axes      JSONB NOT NULL DEFAULT '[]',
  upgrade_rules    JSONB NOT NULL DEFAULT '{}',

  -- 采集配置（灵活 JSON）
  config           JSONB NOT NULL DEFAULT '{}',

  -- 分类与权重
  category         TEXT DEFAULT 'uncategorized',
  tags             JSONB DEFAULT '[]',
  priority         INT DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  fetch_interval   INT DEFAULT 60,

  -- 播客专用
  auto_transcribe  BOOLEAN DEFAULT false,

  -- 健康状态
  last_fetched_at  TIMESTAMPTZ,
  last_item_at     TIMESTAMPTZ,
  health_score     INT DEFAULT 100 CHECK (health_score BETWEEN 0 AND 100),
  error_count      INT DEFAULT 0,
  last_error       TEXT,
  status           TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error', 'disabled')),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sources_user ON hub.sources (user_id);
CREATE INDEX idx_sources_type ON hub.sources (source_type);
CREATE INDEX idx_sources_role ON hub.sources (source_role);
CREATE INDEX idx_sources_tier ON hub.sources (source_tier);
CREATE INDEX idx_sources_processing_profile ON hub.sources (processing_profile);
CREATE INDEX idx_sources_status ON hub.sources (status);
CREATE INDEX idx_sources_category ON hub.sources (category);

-- 信息条目表（核心）
CREATE TABLE hub.items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          INT NOT NULL REFERENCES hub.sources(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES auth.users(id),
  source_type        TEXT NOT NULL,
  source_tier        TEXT NOT NULL DEFAULT 'B',
  processing_profile TEXT NOT NULL DEFAULT 'brief',
  growth_axes        JSONB NOT NULL DEFAULT '[]',

  -- 内容
  guid               TEXT,
  title              TEXT NOT NULL,
  url                TEXT NOT NULL,
  author             TEXT,
  content            TEXT,
  snippet            TEXT,
  language           TEXT,

  -- 媒体
  media_url          TEXT,
  media_type         TEXT CHECK (media_type IS NULL OR media_type IN ('audio', 'video', 'image')),

  -- 时间
  published_at       TIMESTAMPTZ,
  fetched_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 去重
  dedup_hash         BIGINT,

  -- AI 处理结果
  ai_score           REAL CHECK (ai_score IS NULL OR (ai_score >= 0 AND ai_score <= 100)),
  ai_summary         TEXT,
  ai_tags            JSONB DEFAULT '[]',
  ai_translation     TEXT,
  priority_score     REAL CHECK (priority_score IS NULL OR (priority_score >= 0 AND priority_score <= 1)),
  cluster_id         TEXT,

  -- 音频处理
  transcript         TEXT,
  knowledge          TEXT,
  audio_duration     INT,
  audio_status       TEXT DEFAULT 'none' CHECK (audio_status IN ('none', 'pending', 'processing', 'done', 'error')),
  audio_task_id      TEXT,

  -- 向量（pgvector）
  embedding          vector(1024),

  -- 用户状态
  is_read            BOOLEAN DEFAULT false,
  is_favorite        BOOLEAN DEFAULT false,
  is_later           BOOLEAN DEFAULT false,
  is_filtered        BOOLEAN DEFAULT false,
  filter_reason      TEXT,

  -- 处理状态
  processing_status  TEXT DEFAULT 'raw' CHECK (processing_status IN ('raw', 'deduped', 'filtered', 'scored', 'summarized', 'done')),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(url),
  UNIQUE(source_id, guid)
);

-- 向量近似检索索引
CREATE INDEX idx_items_embedding ON hub.items USING hnsw (embedding vector_cosine_ops);

-- 常用查询索引
CREATE INDEX idx_items_user_status ON hub.items (user_id, processing_status);
CREATE INDEX idx_items_user_tier ON hub.items (user_id, source_tier);
CREATE INDEX idx_items_processing_profile ON hub.items (user_id, processing_profile);
CREATE INDEX idx_items_published ON hub.items (published_at DESC);
CREATE INDEX idx_items_priority ON hub.items (priority_score DESC NULLS LAST);
CREATE INDEX idx_items_source ON hub.items (source_id, fetched_at DESC);
CREATE INDEX idx_items_cluster ON hub.items (cluster_id) WHERE cluster_id IS NOT NULL;
CREATE INDEX idx_items_dedup ON hub.items (dedup_hash) WHERE dedup_hash IS NOT NULL;
CREATE INDEX idx_items_read ON hub.items (user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_items_favorite ON hub.items (user_id, is_favorite) WHERE is_favorite = true;

-- 过滤规则表
CREATE TABLE hub.filter_rules (
  id         SERIAL PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id),
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN (
    'keyword_whitelist', 'keyword_blacklist', 'source_priority',
    'time_decay', 'author_filter', 'length_filter', 'language_filter',
    'ai_score_filter'
  )),
  scope      TEXT NOT NULL DEFAULT 'user' CHECK (scope IN ('global', 'user')),
  config     JSONB NOT NULL DEFAULT '{}',
  enabled    BOOLEAN DEFAULT true,
  priority   INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rules_user ON hub.filter_rules (user_id, enabled);
CREATE INDEX idx_rules_scope ON hub.filter_rules (scope, enabled);

-- AI 配置表
CREATE TABLE hub.ai_configs (
  id               SERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES auth.users(id),
  name             TEXT NOT NULL,
  provider         TEXT NOT NULL,
  model            TEXT NOT NULL,
  api_key_enc      TEXT,
  base_url         TEXT,
  temperature      REAL DEFAULT 0.3,
  prompt_template  TEXT NOT NULL,
  prompt_template_id TEXT,
  model_config_id  TEXT,
  type             TEXT NOT NULL DEFAULT 'scoring' CHECK (type IN ('scoring', 'summary', 'translation', 'trends', 'extraction', 'daily_report')),
  is_active        BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_configs_user ON hub.ai_configs (user_id, type);
CREATE INDEX idx_ai_configs_refs ON hub.ai_configs (model_config_id, prompt_template_id);

-- 日报/洞察表
CREATE TABLE hub.insights (
  id           SERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id),
  date         DATE NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('daily', 'weekly')),
  topics       JSONB NOT NULL DEFAULT '[]',
  summary      TEXT,
  item_count   INT DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date, type)
);

-- 采集任务日志表
CREATE TABLE hub.fetch_logs (
  id           SERIAL PRIMARY KEY,
  source_id    INT REFERENCES hub.sources(id) ON DELETE SET NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  status       TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
  items_found  INT DEFAULT 0,
  items_new    INT DEFAULT 0,
  error        TEXT,
  duration_ms  INT
);

CREATE INDEX idx_fetch_logs_source ON hub.fetch_logs (source_id, started_at DESC);

-- ============================================================
-- Schema: audio（音频处理）
-- ============================================================
CREATE SCHEMA IF NOT EXISTS audio;

CREATE TABLE audio.tasks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id),
  title              TEXT NOT NULL,
  source             TEXT DEFAULT 'upload' CHECK (source IN ('upload', 'podcast_rss', 'youtube')),
  item_id            UUID REFERENCES hub.items(id) ON DELETE SET NULL,
  original_filename  TEXT,
  storage_url        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'error')),
  error_message      TEXT,
  duration           REAL,
  cost               REAL,
  transcript         TEXT,
  knowledge_extraction TEXT,
  metadata           JSONB DEFAULT '{}',
  webhook_url        TEXT,
  webhook_sent_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audio_tasks_user ON audio.tasks (user_id, status);
CREATE INDEX idx_audio_tasks_item ON audio.tasks (item_id) WHERE item_id IS NOT NULL;

CREATE TABLE audio.usage_logs (
  id         SERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id),
  task_id    UUID REFERENCES audio.tasks(id) ON DELETE SET NULL,
  tokens     INT,
  cost       REAL,
  provider   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Schema: quota（配额管理）
-- ============================================================
CREATE SCHEMA IF NOT EXISTS quota;

CREATE TABLE quota.plans (
  id                        SERIAL PRIMARY KEY,
  name                      TEXT NOT NULL UNIQUE,
  audio_minutes_per_month   INT DEFAULT 120,
  articles_per_day          INT DEFAULT 1000,
  is_public                 BOOLEAN DEFAULT false
);

CREATE TABLE quota.user_quotas (
  id                        SERIAL PRIMARY KEY,
  user_id                   UUID NOT NULL UNIQUE REFERENCES auth.users(id),
  plan_id                   INT REFERENCES quota.plans(id),
  audio_minutes_used_month  REAL DEFAULT 0,
  audio_minutes_reset_at    TIMESTAMPTZ,
  auto_transcribe_enabled   BOOLEAN DEFAULT false,
  max_auto_per_day          INT DEFAULT 3,
  max_episode_minutes       INT DEFAULT 90,
  monthly_budget_limit      REAL,
  auto_count_today          INT DEFAULT 0,
  auto_count_reset_at       TIMESTAMPTZ
);

-- ============================================================
-- 初始数据：默认配额计划
-- ============================================================
INSERT INTO quota.plans (name, audio_minutes_per_month, articles_per_day, is_public)
VALUES
  ('free', 60, 500, true),
  ('personal', 300, 2000, true),
  ('pro', -1, -1, false)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 初始数据：默认管理员（开发用，密码占位）
-- ============================================================
INSERT INTO auth.users (id, email, username, password_hash, role)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'admin@infohub.local',
  'admin',
  '$2a$10$DMx27ryFMInBUoPM80zgTu2XpBkKcdazBWWQLJLLRO/0kkK4PsdX6',
  'admin'
) ON CONFLICT (email) DO NOTHING;

-- ============================================================
-- 完成提示
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '✅ 信息中枢 v3 数据库初始化完成：auth / hub / audio / quota 4个 schema 已创建';
END $$;

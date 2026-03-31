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

docker compose exec -T postgres psql -U postgres -d infohub <<'SQL'
INSERT INTO hub.filter_rules (user_id, name, type, scope, config, enabled, priority)
SELECT
  NULL,
  'AI高分优先',
  'ai_score_filter',
  'global',
  '{"minAiScore":70,"maxAiScore":100,"boost":20}'::jsonb,
  true,
  20
WHERE NOT EXISTS (
  SELECT 1 FROM hub.filter_rules WHERE scope = 'global' AND name = 'AI高分优先'
);

INSERT INTO hub.filter_rules (user_id, name, type, scope, config, enabled, priority)
SELECT
  NULL,
  'AI主题加权',
  'keyword_whitelist',
  'global',
  '{"keywords":["AI","A.I.","LLM","Agent","OpenAI","Anthropic","Qwen","GPT","Claude","inference","multimodal","人工智能","大模型","智能体","推理","机器学习","生成式"],"boost":18}'::jsonb,
  true,
  15
WHERE NOT EXISTS (
  SELECT 1 FROM hub.filter_rules WHERE scope = 'global' AND name = 'AI主题加权'
);

INSERT INTO hub.filter_rules (user_id, name, type, scope, config, enabled, priority)
SELECT
  NULL,
  '过滤非AI噪音',
  'keyword_blacklist',
  'global',
  '{"keywords":["体育","足球","篮球","娱乐","明星","影视","汽车","房产","旅游","时尚","美食","情感","母婴","游戏","八卦"]}'::jsonb,
  true,
  10
WHERE NOT EXISTS (
  SELECT 1 FROM hub.filter_rules WHERE scope = 'global' AND name = '过滤非AI噪音'
);
SQL

cd "$ROOT_DIR/services/hub-engine"
LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-postgres://postgres:${PG_PASSWORD:-infohub_dev_2026}@127.0.0.1:5432/infohub}"
LOCAL_REDIS_URL="${LOCAL_REDIS_URL:-redis://127.0.0.1:6379}"

DATABASE_URL="$LOCAL_DATABASE_URL" \
REDIS_URL="$LOCAL_REDIS_URL" \
npx tsx scripts/recompute-item-rules.ts

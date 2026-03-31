#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

docker compose exec -T postgres psql -U postgres -d infohub <<'SQL'
DO $$
DECLARE
  default_llm_id UUID;
  scoring_prompt_id UUID;
  summary_prompt_id UUID;
  translation_prompt_id UUID;
  daily_report_prompt_id UUID;
BEGIN
  SELECT id INTO default_llm_id
  FROM public.model_configs
  WHERE model_type = 'llm'
    AND is_active = true
    AND (is_default = true OR model_name = 'dashscope/qwen-flash')
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1;

  INSERT INTO public.prompt_templates (
    id, name, description, category, template_text, variables, is_system, is_active, version, created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    '阅读评分',
    'Feed 条目相关性评分模板',
    'feed_scoring',
    '请根据标题和内容给出 0-100 分相关性评分，仅输出数字。' || E'\n' ||
    '标题：{title}' || E'\n' ||
    '内容：{content}',
    '["title","content"]'::jsonb,
    true,
    true,
    1,
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prompt_templates WHERE category = 'feed_scoring'
  );

  INSERT INTO public.prompt_templates (
    id, name, description, category, template_text, variables, is_system, is_active, version, created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    '阅读摘要',
    'Feed 条目摘要模板',
    'feed_summary',
    '请对内容做结构化摘要，返回 JSON：{"summary":"...","tags":["..."]}。' || E'\n' ||
    '标题：{title}' || E'\n' ||
    '内容：{content}',
    '["title","content"]'::jsonb,
    true,
    true,
    1,
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prompt_templates WHERE category = 'feed_summary'
  );

  INSERT INTO public.prompt_templates (
    id, name, description, category, template_text, variables, is_system, is_active, version, created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    '阅读翻译',
    'Feed 条目翻译模板',
    'feed_translation',
    '请将内容翻译成简体中文，保留专有名词。' || E'\n' ||
    '标题：{title}' || E'\n' ||
    '内容：{content}',
    '["title","content"]'::jsonb,
    true,
    true,
    1,
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prompt_templates WHERE category = 'feed_translation'
  );

  INSERT INTO public.prompt_templates (
    id, name, description, category, template_text, variables, is_system, is_active, version, created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    '日报总览',
    '日报总览点评模板',
    'daily_report',
    '请根据以下日报素材，输出一段 3-5 点的中文总览点评，先写总体判断，再写值得关注的信号。' || E'\n' ||
    '日期：{date}' || E'\n' ||
    '今日新增：{newItems}' || E'\n' ||
    '库存总量：{totalItems}' || E'\n' ||
    '重点条目：' || E'\n' ||
    '{highlights}' || E'\n' ||
    '分类统计：' || E'\n' ||
    '{categories}',
    '["date","newItems","totalItems","highlights","categories"]'::jsonb,
    true,
    true,
    1,
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prompt_templates WHERE category = 'daily_report'
  );

  SELECT id INTO scoring_prompt_id
  FROM public.prompt_templates
  WHERE category = 'feed_scoring' AND is_active = true
  ORDER BY is_system DESC, created_at ASC
  LIMIT 1;

  SELECT id INTO summary_prompt_id
  FROM public.prompt_templates
  WHERE category = 'feed_summary' AND is_active = true
  ORDER BY is_system DESC, created_at ASC
  LIMIT 1;

  SELECT id INTO translation_prompt_id
  FROM public.prompt_templates
  WHERE category = 'feed_translation' AND is_active = true
  ORDER BY is_system DESC, created_at ASC
  LIMIT 1;

  SELECT id INTO daily_report_prompt_id
  FROM public.prompt_templates
  WHERE category = 'daily_report' AND is_active = true
  ORDER BY is_system DESC, created_at ASC
  LIMIT 1;

  UPDATE hub.ai_configs
  SET
    provider = 'dashscope',
    model = 'dashscope/qwen-flash',
    base_url = 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model_config_id = COALESCE(default_llm_id::text, model_config_id),
    prompt_template_id = CASE
      WHEN type = 'scoring' THEN COALESCE(scoring_prompt_id::text, prompt_template_id)
      WHEN type = 'summary' THEN COALESCE(summary_prompt_id::text, prompt_template_id)
      WHEN type = 'translation' THEN COALESCE(translation_prompt_id::text, prompt_template_id)
      WHEN type = 'daily_report' THEN COALESCE(daily_report_prompt_id::text, prompt_template_id)
      ELSE prompt_template_id
    END,
    prompt_template = CASE
      WHEN type = 'scoring' THEN COALESCE((SELECT template_text FROM public.prompt_templates WHERE id = scoring_prompt_id), prompt_template)
      WHEN type = 'summary' THEN COALESCE((SELECT template_text FROM public.prompt_templates WHERE id = summary_prompt_id), prompt_template)
      WHEN type = 'translation' THEN COALESCE((SELECT template_text FROM public.prompt_templates WHERE id = translation_prompt_id), prompt_template)
      WHEN type = 'daily_report' THEN COALESCE((SELECT template_text FROM public.prompt_templates WHERE id = daily_report_prompt_id), prompt_template)
      ELSE prompt_template
    END
  WHERE type IN ('scoring', 'summary', 'translation', 'daily_report');

  INSERT INTO hub.ai_configs (
    user_id, name, provider, model, base_url, temperature,
    prompt_template, model_config_id, prompt_template_id, type, is_active
  )
  SELECT DISTINCT
    user_id,
    '日报总览',
    'dashscope',
    'dashscope/qwen-flash',
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    0.3,
    '请根据以下日报素材，输出一段 3-5 点的中文总览点评，先写总体判断，再写值得关注的信号。' || E'\n' ||
    '日期：{date}' || E'\n' ||
    '今日新增：{newItems}' || E'\n' ||
    '库存总量：{totalItems}' || E'\n' ||
    '重点条目：' || E'\n' ||
    '{highlights}' || E'\n' ||
    '分类统计：' || E'\n' ||
    '{categories}',
    default_llm_id::text,
    daily_report_prompt_id::text,
    'daily_report',
    true
  FROM hub.ai_configs existing
  WHERE NOT EXISTS (
    SELECT 1
    FROM hub.ai_configs current_cfg
    WHERE current_cfg.user_id = existing.user_id
      AND current_cfg.type = 'daily_report'
  );
END $$;
SQL

echo "AI scenes normalized to qwen-flash and bound to default prompt templates."

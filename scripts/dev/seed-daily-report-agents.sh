#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d infohub <<'SQL'
ALTER TABLE public.prompt_templates ALTER COLUMN category TYPE text;
ALTER TABLE hub.ai_configs DROP CONSTRAINT IF EXISTS ai_configs_type_check;

DO $$
DECLARE
  default_llm_id UUID;
  cleaning_prompt_id UUID;
  decision_prompt_id UUID;
  research_prompt_id UUID;
  reading_prompt_id UUID;
  final_prompt_id UUID;
BEGIN
  SELECT id INTO default_llm_id
  FROM public.model_configs
  WHERE model_type = 'llm'
    AND is_active = true
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1;

  INSERT INTO public.prompt_templates (
    id, name, description, category, template_text, variables, is_system, is_active, version, created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    '日报清洗代理',
    '信息清洗、主题聚类与观察名单整理模板',
    'daily_report_cleaning',
    '你是信息清洗代理。请基于 {context} 提炼主题聚类、关键变化、观察名单，输出 JSON。重点识别 AI 基础设施、模型与智能体、头部产品/应用、资本与公司动作、监管与舆论信号。',
    '["context","date","newItems","totalItems","compareWindowDays"]'::jsonb,
    true,
    true,
    1,
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prompt_templates WHERE category = 'daily_report_cleaning'
  );

  INSERT INTO public.prompt_templates (
    id, name, description, category, template_text, variables, is_system, is_active, version, created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    '决策简报代理',
    '输出总体判断、变化、风险机会与动作',
    'daily_report_decision',
    '你是决策简报代理。请基于 {context} 输出：总体判断、关键变化、风险与机会、下一步动作。聚焦 AI 产业、头部舆论新闻、资本与监管信号。',
    '["context","date","newItems","totalItems","compareWindowDays"]'::jsonb,
    true,
    true,
    1,
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prompt_templates WHERE category = 'daily_report_decision'
  );

  INSERT INTO public.prompt_templates (
    id, name, description, category, template_text, variables, is_system, is_active, version, created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    '研究汇总代理',
    '输出主题脉络、代表性证据、分歧与追踪问题',
    'daily_report_research',
    '你是研究汇总代理。请基于 {context} 输出：主题脉络、代表性证据、分歧与空白、值得追踪的问题。重点按 AI 基础设施、模型/智能体、产品落地、监管/舆论、公司/资本信号归纳。',
    '["context","date","newItems","totalItems","compareWindowDays"]'::jsonb,
    true,
    true,
    1,
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prompt_templates WHERE category = 'daily_report_research'
  );

  INSERT INTO public.prompt_templates (
    id, name, description, category, template_text, variables, is_system, is_active, version, created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    '阅读导航代理',
    '输出必读、速览、可跳过三层阅读建议',
    'daily_report_reading',
    '你是阅读导航代理。请基于 {context} 输出：必读、速览、可跳过，并给出每条理由。优先考虑 AI 赛道信息增量、舆论影响和行动价值。',
    '["context","date","newItems","totalItems","compareWindowDays"]'::jsonb,
    true,
    true,
    1,
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prompt_templates WHERE category = 'daily_report_final'
  );

  INSERT INTO public.prompt_templates (
    id, name, description, category, template_text, variables, is_system, is_active, version, created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    '最终日报代理',
    '融合清洗、决策、研究和阅读导航，输出最终日报',
    'daily_report_final',
    '你是最终日报整合代理。请基于 {context} 输出最终中文 Markdown 日报，必须包含：今日结论、关键进展、头部舆论/新闻焦点、AI 产业与产品信号、阅读建议、下一步动作。聚焦 AI 相关与头部舆论新闻，不要跑到医疗专题。',
    '["context","date","newItems","totalItems","compareWindowDays"]'::jsonb,
    true,
    true,
    1,
    now(),
    now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prompt_templates WHERE category = 'daily_report_reading'
  );

  SELECT id INTO cleaning_prompt_id FROM public.prompt_templates WHERE category = 'daily_report_cleaning' AND is_active = true ORDER BY is_system DESC, created_at ASC LIMIT 1;
  SELECT id INTO decision_prompt_id FROM public.prompt_templates WHERE category = 'daily_report_decision' AND is_active = true ORDER BY is_system DESC, created_at ASC LIMIT 1;
  SELECT id INTO research_prompt_id FROM public.prompt_templates WHERE category = 'daily_report_research' AND is_active = true ORDER BY is_system DESC, created_at ASC LIMIT 1;
  SELECT id INTO reading_prompt_id FROM public.prompt_templates WHERE category = 'daily_report_reading' AND is_active = true ORDER BY is_system DESC, created_at ASC LIMIT 1;
  SELECT id INTO final_prompt_id FROM public.prompt_templates WHERE category = 'daily_report_final' AND is_active = true ORDER BY is_system DESC, created_at ASC LIMIT 1;

  UPDATE public.prompt_templates
  SET template_text = '你是信息清洗代理。请基于 {context} 提炼主题聚类、关键变化、观察名单，输出 JSON。重点识别 AI 基础设施、模型与智能体、头部产品/应用、资本与公司动作、监管与舆论信号。',
      updated_at = now()
  WHERE category = 'daily_report_cleaning';

  UPDATE public.prompt_templates
  SET template_text = '你是决策简报代理。请基于 {context} 输出：总体判断、关键变化、风险与机会、下一步动作。聚焦 AI 产业、头部舆论新闻、资本与监管信号。',
      updated_at = now()
  WHERE category = 'daily_report_decision';

  UPDATE public.prompt_templates
  SET template_text = '你是研究汇总代理。请基于 {context} 输出：主题脉络、代表性证据、分歧与空白、值得追踪的问题。重点按 AI 基础设施、模型/智能体、产品落地、监管/舆论、公司/资本信号归纳。',
      updated_at = now()
  WHERE category = 'daily_report_research';

  UPDATE public.prompt_templates
  SET template_text = '你是阅读导航代理。请基于 {context} 输出：必读、速览、可跳过，并给出每条理由。优先考虑 AI 赛道信息增量、舆论影响和行动价值。',
      updated_at = now()
  WHERE category = 'daily_report_reading';

  UPDATE public.prompt_templates
  SET template_text = '你是最终日报整合代理。请基于 {context} 输出最终中文 Markdown 日报，必须包含：今日结论、关键进展、头部舆论/新闻焦点、AI 产业与产品信号、阅读建议、下一步动作。聚焦 AI 相关与头部舆论新闻，不要跑到医疗专题。',
      updated_at = now()
  WHERE category = 'daily_report_final';

  INSERT INTO hub.ai_configs (
    user_id, name, provider, model, base_url, temperature, prompt_template,
    model_config_id, prompt_template_id, type, is_active
  )
  SELECT
    base.user_id,
    scene.scene_name,
    COALESCE(base.provider, 'dashscope'),
    COALESCE(base.model, 'dashscope/qwen-flash'),
    base.base_url,
    base.temperature,
    scene.template_text,
    COALESCE(base.model_config_id, default_llm_id::text),
    scene.prompt_id::text,
    scene.scene_type,
    COALESCE(base.is_active, true)
  FROM (
    SELECT DISTINCT ON (cfg.user_id)
      cfg.user_id,
      cfg.provider,
      cfg.model,
      cfg.base_url,
      cfg.temperature,
      cfg.model_config_id,
      cfg.is_active
    FROM hub.ai_configs cfg
    WHERE cfg.type IN ('daily_report', 'daily_report_decision', 'daily_report_research', 'daily_report_reading', 'daily_report_final')
    ORDER BY cfg.user_id, cfg.created_at DESC
  ) base
  CROSS JOIN LATERAL (
    VALUES
      ('日报清洗', cleaning_prompt_id, 'daily_report_cleaning', '你是信息清洗代理。请基于 {context} 提炼主题聚类、关键变化、观察名单，输出 JSON。重点识别 AI 基础设施、模型与智能体、头部产品/应用、资本与公司动作、监管与舆论信号。'),
      ('决策简报', decision_prompt_id, 'daily_report_decision', '你是决策简报代理。请基于 {context} 输出：总体判断、关键变化、风险与机会、下一步动作。聚焦 AI 产业、头部舆论新闻、资本与监管信号。'),
      ('研究汇总', research_prompt_id, 'daily_report_research', '你是研究汇总代理。请基于 {context} 输出：主题脉络、代表性证据、分歧与空白、值得追踪的问题。重点按 AI 基础设施、模型/智能体、产品落地、监管/舆论、公司/资本信号归纳。'),
      ('阅读导航', reading_prompt_id, 'daily_report_reading', '你是阅读导航代理。请基于 {context} 输出：必读、速览、可跳过，并给出每条理由。优先考虑 AI 赛道信息增量、舆论影响和行动价值。'),
      ('最终日报', final_prompt_id, 'daily_report_final', '你是最终日报整合代理。请基于 {context} 输出最终中文 Markdown 日报，必须包含：今日结论、关键进展、头部舆论/新闻焦点、AI 产业与产品信号、阅读建议、下一步动作。聚焦 AI 相关与头部舆论新闻，不要跑到医疗专题。')
  ) AS scene(scene_name, prompt_id, scene_type, template_text)
  WHERE NOT EXISTS (
    SELECT 1
    FROM hub.ai_configs existing
    WHERE existing.user_id = base.user_id
      AND existing.type = scene.scene_type
  );

  UPDATE hub.ai_configs
  SET
    prompt_template = '你是信息清洗代理。请基于 {context} 提炼主题聚类、关键变化、观察名单，输出 JSON。重点识别 AI 基础设施、模型与智能体、头部产品/应用、资本与公司动作、监管与舆论信号。',
    prompt_template_id = cleaning_prompt_id::text,
    model_config_id = COALESCE(model_config_id, default_llm_id::text)
  WHERE type = 'daily_report_cleaning';

  UPDATE hub.ai_configs
  SET
    prompt_template = '你是决策简报代理。请基于 {context} 输出：总体判断、关键变化、风险与机会、下一步动作。聚焦 AI 产业、头部舆论新闻、资本与监管信号。',
    prompt_template_id = decision_prompt_id::text,
    model_config_id = COALESCE(model_config_id, default_llm_id::text)
  WHERE type = 'daily_report_decision';

  UPDATE hub.ai_configs
  SET
    prompt_template = '你是研究汇总代理。请基于 {context} 输出：主题脉络、代表性证据、分歧与空白、值得追踪的问题。重点按 AI 基础设施、模型/智能体、产品落地、监管/舆论、公司/资本信号归纳。',
    prompt_template_id = research_prompt_id::text,
    model_config_id = COALESCE(model_config_id, default_llm_id::text)
  WHERE type = 'daily_report_research';

  UPDATE hub.ai_configs
  SET
    prompt_template = '你是阅读导航代理。请基于 {context} 输出：必读、速览、可跳过，并给出每条理由。优先考虑 AI 赛道信息增量、舆论影响和行动价值。',
    prompt_template_id = reading_prompt_id::text,
    model_config_id = COALESCE(model_config_id, default_llm_id::text)
  WHERE type = 'daily_report_reading';

  UPDATE hub.ai_configs
  SET
    prompt_template = '你是最终日报整合代理。请基于 {context} 输出最终中文 Markdown 日报，必须包含：今日结论、关键进展、头部舆论/新闻焦点、AI 产业与产品信号、阅读建议、下一步动作。聚焦 AI 相关与头部舆论新闻，不要跑到医疗专题。',
    prompt_template_id = final_prompt_id::text,
    model_config_id = COALESCE(model_config_id, default_llm_id::text)
  WHERE type = 'daily_report_final';
END $$;
SQL

echo "Daily report agent prompts and scene bindings seeded."

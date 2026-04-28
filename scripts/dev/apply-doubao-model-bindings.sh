#!/usr/bin/env bash
set -euo pipefail

# Idempotently switch active hub AI scenes to the active/default Volcengine Ark
# model config. Secrets stay in the database/.env; this script only rewires
# scene bindings to the selected model_config_id.

docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d infohub <<'SQL'
do $$
declare
  target_id text;
  target_model text;
  target_base_url text;
  scene_types text[] := array[
    'quality_filter',
    'scoring',
    'summary',
    'translation',
    'daily_report',
    'daily_report_cleaning',
    'daily_report_decision',
    'daily_report_research',
    'daily_report_reading',
    'daily_report_final'
  ];
  touched integer := 0;
begin
  select
    id::text,
    coalesce(extra_config->>'endpointId', model_name),
    coalesce(base_url, 'https://ark.cn-beijing.volces.com/api/v3')
  into target_id, target_model, target_base_url
  from public.model_configs
  where provider = 'volcengine_ark'
    and is_active = true
    and (
      model_name like 'ep-%'
      or coalesce(extra_config->>'endpointId', '') like 'ep-%'
    )
  order by is_default desc, updated_at desc nulls last, created_at desc nulls last
  limit 1;

  if target_id is null then
    raise exception 'No active Volcengine Ark endpoint model found. Set ARK_API_KEY and DEFAULT_LLM_ENDPOINT_ID, then restart audio-service.';
  end if;

  update public.model_configs
  set
    alias = coalesce(nullif(alias, ''), '豆包-默认主模型'),
    is_default = true,
    is_active = true,
    base_url = target_base_url,
    extra_config = coalesce(extra_config, '{}'::jsonb)
      || jsonb_build_object('accessMode', 'endpoint', 'endpointId', target_model)
  where id::text = target_id;

  update public.model_configs
  set is_default = false
  where model_type = 'llm'
    and id::text <> target_id;

  update public.model_configs
  set
    is_default = false,
    is_active = false,
    test_status = 'failed',
    test_message = 'Disabled by Doubao binding migration: endpoint id cannot be attached to DashScope provider.'
  where provider <> 'volcengine_ark'
    and model_name like 'ep-%';

  update hub.ai_configs
  set
    provider = 'volcengine_ark',
    model = target_model,
    base_url = target_base_url,
    model_config_id = target_id
  where is_active = true
    and type = any(scene_types);

  get diagnostics touched = row_count;
  raise notice 'Bound % active AI scene rows to % (%).', touched, target_id, target_model;
end $$;
SQL

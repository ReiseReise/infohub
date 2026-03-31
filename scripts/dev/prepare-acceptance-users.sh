#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT_DIR="$ROOT_DIR"
HUB_DIR="$ROOT_DIR/services/hub-engine"

ADMIN_EMAIL="${ACCEPTANCE_ADMIN_EMAIL:-acceptance.admin@infohub.local}"
ADMIN_USERNAME="${ACCEPTANCE_ADMIN_USERNAME:-acceptance_admin}"
ADMIN_PASSWORD="${ACCEPTANCE_ADMIN_PASSWORD:-InfoHubAdmin2026}"

USER_EMAIL="${ACCEPTANCE_USER_EMAIL:-acceptance.user@infohub.local}"
USER_USERNAME="${ACCEPTANCE_USER_USERNAME:-acceptance_user}"
USER_PASSWORD="${ACCEPTANCE_USER_PASSWORD:-InfoHubUser2026}"

ADMIN_HASH="$(
  cd "$HUB_DIR"
  ACCEPTANCE_PASSWORD="$ADMIN_PASSWORD" node --input-type=module <<'NODE'
import bcrypt from 'bcryptjs';
const password = process.env.ACCEPTANCE_PASSWORD || '';
console.log(await bcrypt.hash(password, 10));
NODE
)"

USER_HASH="$(
  cd "$HUB_DIR"
  ACCEPTANCE_PASSWORD="$USER_PASSWORD" node --input-type=module <<'NODE'
import bcrypt from 'bcryptjs';
const password = process.env.ACCEPTANCE_PASSWORD || '';
console.log(await bcrypt.hash(password, 10));
NODE
)"

docker compose exec -T postgres psql -U postgres -d infohub <<SQL
INSERT INTO auth.users (email, username, password_hash, role, is_active)
VALUES
  ('${ADMIN_EMAIL}', '${ADMIN_USERNAME}', '${ADMIN_HASH}', 'admin', true),
  ('${USER_EMAIL}', '${USER_USERNAME}', '${USER_HASH}', 'user', true)
ON CONFLICT (email) DO UPDATE
SET
  username = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  is_active = true;

WITH free_plan AS (
  SELECT id FROM quota.plans WHERE name = 'free' LIMIT 1
)
INSERT INTO quota.user_quotas (user_id, plan_id)
SELECT u.id, free_plan.id
FROM auth.users u, free_plan
WHERE u.email IN ('${ADMIN_EMAIL}', '${USER_EMAIL}')
ON CONFLICT (user_id) DO NOTHING;

WITH target_admin AS (
  SELECT id FROM auth.users WHERE email = '${ADMIN_EMAIL}' LIMIT 1
), template_admin AS (
  SELECT COALESCE(
    (SELECT id FROM auth.users WHERE email = 'reise@infohub.local' LIMIT 1),
    (SELECT id FROM auth.users WHERE role = 'admin' AND is_active = true ORDER BY created_at ASC LIMIT 1)
  ) AS id
)
INSERT INTO hub.ai_configs (
  user_id, name, provider, model, api_key_enc, base_url, temperature, prompt_template,
  model_config_id, prompt_template_id, type, is_active
)
SELECT
  (SELECT id FROM target_admin),
  template_cfg.name,
  template_cfg.provider,
  template_cfg.model,
  template_cfg.api_key_enc,
  template_cfg.base_url,
  template_cfg.temperature,
  template_cfg.prompt_template,
  template_cfg.model_config_id,
  template_cfg.prompt_template_id,
  template_cfg.type,
  template_cfg.is_active
FROM hub.ai_configs template_cfg
WHERE template_cfg.user_id = (SELECT id FROM template_admin)
  AND template_cfg.type IN ('scoring', 'summary', 'translation', 'daily_report')
  AND NOT EXISTS (
    SELECT 1
    FROM hub.ai_configs target_cfg
    WHERE target_cfg.user_id = (SELECT id FROM target_admin)
      AND target_cfg.type = template_cfg.type
  );
SQL

cat <<EOF
验收账号已准备完成：

ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

USER_EMAIL=${USER_EMAIL}
USER_USERNAME=${USER_USERNAME}
USER_PASSWORD=${USER_PASSWORD}
EOF

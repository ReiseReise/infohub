#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKERIGNORE="$ROOT_DIR/.dockerignore"
GITIGNORE="$ROOT_DIR/.gitignore"
DOCKERFILE="$ROOT_DIR/nginx/Dockerfile"
OVERRIDE_EXAMPLE="$ROOT_DIR/docker-compose.ops-auth.yml.example"

require_exact_line() {
  local file="$1"
  local expected="$2"
  if ! grep -Fxq -- "$expected" "$file"; then
    echo "security context policy failed: missing '$expected' in ${file#"$ROOT_DIR/"}" >&2
    exit 1
  fi
}

for excluded in \
  '.env' '.env.*' 'local-secrets/' 'data/' 'backups/' 'exports/' 'output/' \
  'migration-backups/' 'portable-bundles/' 'playwright-report/' 'test-results/' \
  '.playwright-cli/' '.playwright-mcp/' '.agents/' '.claude/' '.codex/' \
  '.cursor/' '.vscode/' '.workbuddy/'; do
  require_exact_line "$DOCKERIGNORE" "$excluded"
done
require_exact_line "$DOCKERIGNORE" '!.env.example'
require_exact_line "$GITIGNORE" 'output/'
require_exact_line "$GITIGNORE" 'docker-compose.ops-auth.yml'

if grep -Eq '^[[:space:]]*COPY[[:space:]].*local-secrets' "$DOCKERFILE"; then
  echo "security context policy failed: Dockerfile must not COPY local-secrets" >&2
  exit 1
fi
if ! grep -Fq "printf 'disabled:!\\n' > /etc/nginx/ops.htpasswd" "$DOCKERFILE"; then
  echo "security context policy failed: fail-closed htpasswd placeholder is missing" >&2
  exit 1
fi
if ! grep -Eq 'chmod[[:space:]]+0444[[:space:]]+/etc/nginx/ops\.htpasswd' "$DOCKERFILE"; then
  echo "security context policy failed: htpasswd placeholder must be read-only" >&2
  exit 1
fi

require_exact_line "$OVERRIDE_EXAMPLE" '      - ./local-secrets/ops.htpasswd:/etc/nginx/ops.htpasswd:ro'
if grep -Eq ':[^[:space:]]+:[^[:space:]]+:[^[:space:]]+' "$OVERRIDE_EXAMPLE"; then
  echo "security context policy failed: override example contains an unexpected mount shape" >&2
  exit 1
fi

echo "security-context-policy: PASS"

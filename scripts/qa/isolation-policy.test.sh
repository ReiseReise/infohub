#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=isolation-policy.sh
source "$SCRIPT_DIR/isolation-policy.sh"

assert_refused() {
  local error
  error="$(qa_isolation_error "$@")"
  if [ -z "$error" ]; then
    echo "expected isolation policy refusal" >&2
    exit 1
  fi
}

assert_refused
assert_refused 0 http://127.0.0.1:3001 infohub-postgres 1
assert_refused 1 http://127.0.0.1:39001 infohub-postgres-qa 0
assert_refused 1 https://qa.invalid infohub-postgres-qa 0

if assert_qa_isolation 1 https://qa.invalid infohub-postgres-qa 0 2>/dev/null; then
  echo "expected the regression entrypoint to remain disabled" >&2
  exit 1
fi

echo "qa-isolation-policy: 5/5 PASS"

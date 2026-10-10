#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config-policy.sh
source "$SCRIPT_DIR/config-policy.sh"

assert_mode() {
  local expected="$1"
  shift
  local actual
  actual="$(resolve_portable_config_mode "$@")"
  if [ "$actual" != "$expected" ]; then
    echo "expected $expected, got $actual" >&2
    exit 1
  fi
}

assert_mode encrypted true true false false
assert_mode plaintext true false true false
assert_mode skipped true false false true
assert_mode missing false false false false
assert_mode refused true false false false

echo "config-policy: 5/5 PASS"

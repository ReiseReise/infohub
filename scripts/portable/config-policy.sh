#!/usr/bin/env bash

# Pure policy: prints one of encrypted/plaintext/skipped/missing/refused.
# Arguments: has_env has_passphrase plain_env_requested skip_config_requested
resolve_portable_config_mode() {
  local has_env="${1:-false}"
  local has_passphrase="${2:-false}"
  local plain_env_requested="${3:-false}"
  local skip_config_requested="${4:-false}"

  if [ "$skip_config_requested" = "true" ]; then
    echo "skipped"
  elif [ "$has_env" != "true" ]; then
    echo "missing"
  elif [ "$has_passphrase" = "true" ]; then
    echo "encrypted"
  elif [ "$plain_env_requested" = "true" ]; then
    echo "plaintext"
  else
    echo "refused"
  fi
}

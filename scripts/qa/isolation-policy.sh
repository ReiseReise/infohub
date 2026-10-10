#!/usr/bin/env bash

qa_isolation_error() {
  echo "no complete isolated QA runner or dependency manifest is available; full regression is disabled"
}

assert_qa_isolation() {
  local error
  error="$(qa_isolation_error "$@")"
  if [ -n "$error" ]; then
    echo "QA isolation policy refused regression: $error" >&2
    return 1
  fi
}

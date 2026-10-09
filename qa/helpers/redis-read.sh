#!/usr/bin/env bash

redis_read() {
  local result
  # Keep credentials inside the container environment, never in argv or host output.
  result="$(docker exec "$REDIS_CONTAINER" sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" exec redis-cli --raw -e "$@"' sh "$@")" || {
    echo "Redis observation failed: connection or authentication error" >&2
    return 1
  }
  result="${result//$'\r'/}"
  case "$result" in
    *NOAUTH*|*WRONGPASS*|ERR\ *|\(error\)*)
      echo "Redis observation failed: server rejected the query" >&2
      return 1 ;;
  esac
  printf '%s' "$result"
}

redis_numeric() {
  local result
  result="$(redis_read "$@")" || return 1
  case "$result" in
    ''|*[!0-9]*) echo "Redis observation failed: expected a nonnegative count" >&2; return 1 ;;
  esac
  printf '%s' "$result"
}

redis_count() {
  local key="$1" key_type
  key_type="$(redis_read TYPE "$key")" || return 1
  case "$key_type" in
    list) redis_numeric LLEN "$key" ;;
    zset) redis_numeric ZCARD "$key" ;;
    set) redis_numeric SCARD "$key" ;;
    hash) redis_numeric HLEN "$key" ;;
    none) printf '0' ;;
    *) echo "Redis observation failed: unexpected queue key type" >&2; return 1 ;;
  esac
}

redis_recent_failure_count() {
  local key="$1" since_ms="$2" key_type
  key_type="$(redis_read TYPE "$key")" || return 1
  case "$key_type" in
    zset) redis_numeric ZCOUNT "$key" "$since_ms" +inf ;;
    none) printf '0' ;;
    *) echo "Redis observation failed: unexpected failed-job key type" >&2; return 1 ;;
  esac
}

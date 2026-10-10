#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/redis-read.sh"
REDIS_CONTAINER="test-only"
MOCK_TYPE="list"
MOCK_COUNT="12"
docker() {
  [[ "$1" == exec && "$2" == test-only && "$3" == sh && "$4" == -c ]]
  [[ "$5" == *'REDISCLI_AUTH="$REDIS_PASSWORD"'* && "$5" == *'--raw -e'* ]]
  if [[ "$MOCK_TYPE" == disconnected ]]; then return 1; fi
  if [[ "$7" == TYPE ]]; then printf '%s' "$MOCK_TYPE"; else printf '%s' "$MOCK_COUNT"; fi
}
[[ "$(redis_count bull:fetch:wait)" == 12 ]]
MOCK_TYPE=zset
[[ "$(redis_recent_failure_count bull:item-translation:failed 0)" == 12 ]]
MOCK_TYPE=none
[[ "$(redis_count absent)" == 0 ]]
for MOCK_TYPE in NOAUTH WRONGPASS string disconnected; do
  if redis_count failed >/dev/null 2>&1; then echo "False zero for $MOCK_TYPE"; exit 1; fi
  if redis_recent_failure_count failed 0 >/dev/null 2>&1; then echo "False recent zero for $MOCK_TYPE"; exit 1; fi
done
MOCK_TYPE=list
MOCK_COUNT='ERR permission denied'
if redis_count failed >/dev/null 2>&1; then echo 'Accepted rejected count'; exit 1; fi
echo 'redis-observation: PASS (authenticated reads; errors cannot become zero)'

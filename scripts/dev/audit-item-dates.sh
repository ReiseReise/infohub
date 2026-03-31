#!/usr/bin/env bash
set -euo pipefail

LIMIT="${LIMIT:-20}"
SOURCE_ID="${SOURCE_ID:-}"

QUERY="
select
  i.id,
  s.name as source_name,
  i.title,
  i.published_at,
  i.fetched_at,
  left(coalesce(i.snippet, ''), 120) as snippet
from hub.items i
left join hub.sources s on s.id = i.source_id
where 1=1
"

if [[ -n "$SOURCE_ID" ]]; then
  QUERY="${QUERY} and i.source_id = ${SOURCE_ID}"
fi

QUERY="${QUERY} order by coalesce(i.published_at, i.fetched_at) desc limit ${LIMIT};"

docker exec -i infohub-postgres psql -U infohub -d infohub -P pager=off -c "$QUERY"

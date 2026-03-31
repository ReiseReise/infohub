#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ARCHIVE_DIR="$ROOT_DIR/docs/归档"

STAGE_ID="${STAGE_ID:-}"
TOPIC="${TOPIC:-}"
OWNER="${OWNER:-AIReie}"

usage() {
  cat <<'EOF'
用法:
  bash scripts/docs/init-archive.sh --stage <stage-id> --topic <topic>

参数:
  --stage   阶段标识（如 phase3 / stage-bc）
  --topic   迭代主题（用于文件名）
  --owner   归档 owner（可选，默认 AIReie）
EOF
}

slugify() {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9_-]/-/g' \
    | sed 's/-\{2,\}/-/g' \
    | sed 's/^-//; s/-$//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage)
      STAGE_ID="${2:-}"
      shift 2
      ;;
    --topic)
      TOPIC="${2:-}"
      shift 2
      ;;
    --owner)
      OWNER="${2:-AIReie}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$STAGE_ID" || -z "$TOPIC" ]]; then
  echo "错误: --stage 和 --topic 必填" >&2
  usage
  exit 1
fi

DATE="$(date +%F)"
TOPIC_SLUG="$(slugify "$TOPIC")"
ITER_FILE="$ARCHIVE_DIR/迭代/${DATE}-${TOPIC_SLUG}.md"

mkdir -p "$ARCHIVE_DIR/迭代"

if [[ -f "$ITER_FILE" ]]; then
  echo "已存在: $ITER_FILE"
  exit 0
fi

cat > "$ITER_FILE" <<EOF
---
title: ${DATE} 迭代归档 — ${TOPIC}
type: iteration-archive
status: in_progress
version: 1.0
owner: ${OWNER}
created: ${DATE}
updated: ${DATE}
tags: [iteration, ${STAGE_ID}]
---

# ${DATE} 迭代归档：${TOPIC}

## 1. 迭代目标

- 阶段：${STAGE_ID}
- 主题：${TOPIC}

## 2. 变更摘要

- 功能：
- 文档：
- 测试：

## 3. 验证结果

| 检查项 | 结果 | 备注 |
|---|---|---|
| 构建 | 待执行 |  |
| 回归 | 待执行 |  |
| 门禁 | 待执行 |  |

## 4. 遗留问题

- 

## 5. 下一迭代计划

- 
EOF

echo "已创建迭代归档: $ITER_FILE"

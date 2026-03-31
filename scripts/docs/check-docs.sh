#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
STRICT=false
FAIL=0

usage() {
  cat <<'EOF'
用法:
  bash scripts/docs/check-docs.sh [--strict]

参数:
  --strict   开启严格模式（检查阶段归档数量、frontmatter完整性）
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT=true
      shift
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

info() { echo "[INFO] $*"; }
ok()   { echo "[PASS] $*"; }
bad()  { echo "[FAIL] $*"; FAIL=$((FAIL+1)); }

require_file() {
  local f="$1"
  if [[ -f "$ROOT_DIR/$f" ]]; then
    ok "文件存在: $f"
  else
    bad "文件缺失: $f"
  fi
}

check_frontmatter_keys() {
  local file="$1"
  local keys=("title" "type" "status" "version" "owner" "created" "updated" "tags")
  local header

  if [[ ! -f "$file" ]]; then
    bad "frontmatter 检查失败，文件不存在: $file"
    return
  fi

  header="$(awk '
    NR==1 && $0=="---" { in_header=1; next }
    in_header && $0=="---" { exit }
    in_header { print }
  ' "$file")"

  if [[ -z "$header" ]]; then
    bad "frontmatter 缺失: $file"
    return
  fi

  for k in "${keys[@]}"; do
    if echo "$header" | grep -Eq "^${k}:"; then
      :
    else
      bad "frontmatter 缺少 ${k}: $file"
    fi
  done
}

info "检查基础文件..."
BASE_FILES=(
  "README.md"
  "CHANGELOG.md"
  "RELEASE_NOTES.md"
  "docs/00-文档总导航.md"
  "docs/01-顶层架构设计.md"
  "docs/02-当前状态与功能地图.md"
  "docs/03-路线图与优化计划.md"
  "docs/04-关键实现专题.md"
  "docs/05-运维与使用手册.md"
  "docs/06-质量门禁与测试规范.md"
  "docs/07-总览仪表板.html"
  "docs/归档/00-归档导航.md"
  "qa/reports/index.md"
)

for f in "${BASE_FILES[@]}"; do
  require_file "$f"
done

info "检查模板文件..."
TEMPLATE_FILES=(
  "docs/归档/模板/阶段归档模板.md"
  "docs/归档/模板/迭代归档模板.md"
  "docs/归档/模板/发布说明模板.md"
  "docs/归档/模板/质量保证摘要模板.md"
)
for f in "${TEMPLATE_FILES[@]}"; do
  require_file "$f"
done

info "检查脚本入口..."
SCRIPT_FILES=(
  "scripts/docs/init-archive.sh"
  "scripts/docs/check-docs.sh"
  "scripts/qa/run-regression.sh"
  "Makefile"
)
for f in "${SCRIPT_FILES[@]}"; do
  require_file "$f"
done

if [[ "$STRICT" == "true" ]]; then
  info "严格模式：检查归档 frontmatter..."
  while IFS= read -r f; do
    check_frontmatter_keys "$f"
  done < <(find "$ROOT_DIR/docs/归档" -type f -name "*.md" | sort)

  info "严格模式：检查阶段归档数量..."
  STAGE_COUNT="$(find "$ROOT_DIR/docs/归档/阶段" -type f -name "*.md" | wc -l | tr -d ' ')"
  if [[ "${STAGE_COUNT:-0}" -ge 9 ]]; then
    ok "阶段归档数量满足要求: $STAGE_COUNT"
  else
    bad "阶段归档数量不足，期望 >= 9，实际 $STAGE_COUNT"
  fi
fi

if [[ "$FAIL" -gt 0 ]]; then
  echo "[RESULT] 文档检查失败: $FAIL 项"
  exit 1
fi

echo "[RESULT] 文档检查通过"

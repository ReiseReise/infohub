#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
FULL=false
OUTPUT=""
NO_REPORT=false

usage() {
  cat <<'EOF'
用法:
  bash scripts/qa/run-regression.sh [--full] [--output <path>] [--no-report]

参数:
  --full           执行全量回归（phase0/1/2/3/4/5/stage-a/stage-bc）
  --output <path>  自定义输出报告路径（默认 qa/reports/<ts>-regression.md）
  --no-report      只输出执行结果，不写入回归报告文件
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --full)
      FULL=true
      shift
      ;;
    --output)
      OUTPUT="${2:-}"
      shift 2
      ;;
    --no-report)
      NO_REPORT=true
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

TS="$(date +%Y%m%d_%H%M%S)"
if [[ "$NO_REPORT" != "true" ]]; then
  if [[ -z "$OUTPUT" ]]; then
    OUTPUT="$ROOT_DIR/qa/reports/${TS}-regression.md"
  else
    if [[ "$OUTPUT" != /* ]]; then
      OUTPUT="$ROOT_DIR/$OUTPUT"
    fi
  fi
  mkdir -p "$(dirname "$OUTPUT")"
fi

if [[ "$FULL" == "true" ]]; then
  SUITE=(
    "qa/p0/test_rss_content_integrity.sh"
    "qa/p0/test_audio_url_async_lifecycle.sh"
    "qa/p0/test_auto_transcribe_policy.sh"
    "qa/p0/test_discovery_diagnostics.sh"
    "qa/p0/test_frontend_e2e_folo.sh"
    "qa/phase0/test_infrastructure.sh"
    "qa/phase1/test_hub_engine.sh"
    "qa/phase2/test_ai_outputs.sh"
    "qa/phase3/test_frontend.sh"
    "qa/phase4/test_collectors.sh"
    "qa/phase5/test_knowledge.sh"
    "qa/stage-a/test_migration.sh"
    "qa/stage-bc/test_ai_and_frontend.sh"
  )
else
  SUITE=(
    "qa/p0/test_discovery_diagnostics.sh"
    "qa/p0/test_frontend_e2e_folo.sh"
    "qa/phase1/test_hub_engine.sh"
    "qa/phase3/test_frontend.sh"
    "qa/stage-bc/test_ai_and_frontend.sh"
  )
fi

PASS=0
FAIL=0
TMP_OUT="$(mktemp)"
trap 'rm -f "$TMP_OUT"' EXIT

if [[ "$NO_REPORT" != "true" ]]; then
  {
    echo "# 回归测试报告"
    echo
    echo "- 时间: $(date '+%F %T')"
    echo "- 模式: $([[ "$FULL" == "true" ]] && echo "full" || echo "quick")"
    echo
    echo "## 结果总览"
    echo
    echo "| 脚本 | 结果 |"
    echo "|---|---|"
  } > "$OUTPUT"
fi

for script in "${SUITE[@]}"; do
  echo "[RUN] $script"
  set +e
  bash "$ROOT_DIR/$script" > "$TMP_OUT" 2>&1
  RC=$?
  set -e

  if [[ "$RC" -eq 0 ]]; then
    STATUS="PASS"
    PASS=$((PASS+1))
  else
    STATUS="FAIL"
    FAIL=$((FAIL+1))
  fi

  if [[ "$NO_REPORT" != "true" ]]; then
    echo "| \`$script\` | $STATUS |" >> "$OUTPUT"
    {
      echo
      echo "## $script ($STATUS)"
      echo
      echo '```text'
      cat "$TMP_OUT"
      echo '```'
    } >> "$OUTPUT"
  fi
done

if [[ "$NO_REPORT" != "true" ]]; then
  {
    echo
    echo "## 汇总"
    echo
    echo "- PASS: $PASS"
    echo "- FAIL: $FAIL"
  } >> "$OUTPUT"
  echo "报告已生成: $OUTPUT"
fi

echo "回归完成: PASS=$PASS FAIL=$FAIL MODE=$([[ "$FULL" == "true" ]] && echo "full" || echo "quick")"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi

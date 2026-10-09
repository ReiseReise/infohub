#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMPORT_SCRIPT="$ROOT_DIR/scripts/portable/import-bundle.sh"
EXPORT_SCRIPT="$ROOT_DIR/scripts/portable/export-bundle.sh"

line_number() {
  local pattern="$1"
  local file="$2"
  grep -nF -- "$pattern" "$file" | head -n1 | cut -d: -f1
}

last_line_number() {
  local pattern="$1"
  local file="$2"
  grep -nF -- "$pattern" "$file" | tail -n1 | cut -d: -f1
}

confirm_line="$(line_number 'if [ "$CONFIRM_RESTORE" = false ]; then' "$IMPORT_SCRIPT")"
input_line="$(last_line_number 'if [ -z "$BUNDLE_INPUT" ]; then' "$IMPORT_SCRIPT")"
need_docker_line="$(line_number 'need_cmd docker' "$IMPORT_SCRIPT")"
unpack_line="$(line_number 'TMP_DIR="$(mktemp -d)"' "$IMPORT_SCRIPT")"
backup_line="$(line_number 'BACKUP_ROOT="$ROOT_DIR/migration-backups/' "$IMPORT_SCRIPT")"

for boundary in "$input_line" "$need_docker_line" "$unpack_line" "$backup_line"; do
  if [ -z "$confirm_line" ] || [ -z "$boundary" ] || [ "$confirm_line" -ge "$boundary" ]; then
    echo "portable import safety failed: --yes guard must precede validation and side effects" >&2
    exit 1
  fi
done

expected_dirs='for dir_name in knowledge audio-uploads changedetection ntfy dibao; do'
if ! grep -Fq "$expected_dirs" "$IMPORT_SCRIPT" || ! grep -Fq "$expected_dirs" "$EXPORT_SCRIPT"; then
  echo "portable import safety failed: export/import data directory allowlists are asymmetric" >&2
  exit 1
fi

project_snapshot() {
  if [ -d "$ROOT_DIR/migration-backups" ]; then
    find "$ROOT_DIR/migration-backups" -mindepth 1 -maxdepth 1 -print | LC_ALL=C sort
  fi
}

env_metadata() {
  if [ ! -e "$ROOT_DIR/.env" ]; then
    echo absent
  elif stat -f '%i:%m:%z' "$ROOT_DIR/.env" >/dev/null 2>&1; then
    stat -f '%i:%m:%z' "$ROOT_DIR/.env"
  else
    stat -c '%i:%Y:%s' "$ROOT_DIR/.env"
  fi
}

before_backups="$(project_snapshot)"
before_env="$(env_metadata)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

if bash "$IMPORT_SCRIPT" "$TEST_DIR/config-only-bundle" --skip-data >"$TEST_DIR/output.log" 2>&1; then
  echo "portable import safety failed: config-only import ran without --yes" >&2
  exit 1
fi
if ! grep -Fq -- '--yes' "$TEST_DIR/output.log"; then
  echo "portable import safety failed: rejection did not explain the --yes requirement" >&2
  exit 1
fi
if [ "$(project_snapshot)" != "$before_backups" ] || [ "$(env_metadata)" != "$before_env" ]; then
  echo "portable import safety failed: unconfirmed import changed project state" >&2
  exit 1
fi

echo "portable-import-safety-policy: PASS"

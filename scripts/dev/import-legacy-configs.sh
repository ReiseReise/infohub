#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="dry-run"
TARGET_ENV="$ROOT_DIR/.env"

while (($# > 0)); do
  case "$1" in
    --apply)
      MODE="apply"
      shift
      ;;
    --dry-run)
      MODE="dry-run"
      shift
      ;;
    --target-env)
      TARGET_ENV="${2:?target env required}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

node --input-type=module - "$ROOT_DIR" "$TARGET_ENV" "$MODE" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const [, , rootDirArg, targetEnvArg, mode] = process.argv;
const rootDir = path.resolve(rootDirArg);
const targetEnv = path.resolve(targetEnvArg);

const legacySources = [
  path.join(rootDir, '../audio-insight/backend/.env.prod'),
  path.join(rootDir, '../audio-insight/backend/.env'),
  path.join(rootDir, '../信息中枢/app/.env'),
];

const blockedKeys = new Set([
  'JWT_SECRET',
  'SECRET_KEY',
  'INTERNAL_API_KEY',
  'AUDIO_WEBHOOK_SECRET',
  'ADMIN_PASSWORD',
  'AUDIO_ADMIN_PASSWORD',
  'FIRST_INVITE_CODE',
  'ADMIN_EMAIL',
  'AUDIO_ADMIN_EMAIL',
]);

const weakValues = new Set([
  '',
  'change-me-please',
  'your-jwt-secret-key-change-me-to-random-string',
  'dev_jwt_secret_change_me',
  'change_me_jwt_secret_at_least_32_chars',
  'your_admin_password_here',
  'your_jwt_secret_32chars_minimum_here',
  'your_webhook_secret_here',
  'AUDIO-INSIGHT-2026',
]);

const keyMap = new Map([
  ['OSS_BUCKET', 'OSS_BUCKET_NAME'],
  ['DEFAULT_LLM_API_KEY', 'DASHSCOPE_API_KEY'],
  ['STORAGE_BACKEND', 'AUDIO_STORAGE_BACKEND'],
  ['SECRET_KEY', 'JWT_SECRET'],
  ['ADMIN_PASSWORD', 'AUDIO_ADMIN_PASSWORD'],
  ['ADMIN_EMAIL', 'AUDIO_ADMIN_EMAIL'],
]);

const passthroughKeys = new Set([
  'DASHSCOPE_API_KEY',
  'DEFAULT_LLM_MODEL',
  'ARK_API_KEY',
  'ARK_BASE_URL',
  'ARK_MODEL',
  'TINGWU_ACCESS_KEY_ID',
  'TINGWU_ACCESS_KEY_SECRET',
  'TINGWU_REGION',
  'TINGWU_APP_KEY',
  'AUDIO_STORAGE_BACKEND',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'OSS_BUCKET_NAME',
  'OSS_ENDPOINT',
  'OSS_REGION',
  'OPENAI_API_KEY',
  'OPENAI_API_BASE',
  'OPENAI_BASE_URL',
  'GOOGLE_API_KEY',
  'ANTHROPIC_API_KEY',
  'ENCRYPTION_KEY',
  'CORS_ORIGINS',
  'CELERY_TASK_SOFT_LIMIT_SECONDS',
  'CELERY_TASK_LIMIT_SECONDS',
]);

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const entries = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = rawLine.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let [, key, value] = match;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries.set(key, value);
  }
  return entries;
}

function normalizeKey(key) {
  return keyMap.get(key) || key;
}

function shouldImport(key, value) {
  const normalized = normalizeKey(key);
  if (blockedKeys.has(normalized)) return false;
  if (!passthroughKeys.has(normalized)) return false;
  if (!value || weakValues.has(value.trim())) return false;
  return true;
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function upsertEnvContent(content, updates) {
  const lines = content.split(/\r?\n/);
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match) return line;
    const key = match[1];
    if (!updates.has(key)) return line;
    seen.add(key);
    return `${key}=${updates.get(key)}`;
  });
  for (const [key, value] of updates) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }
  return nextLines.join('\n').replace(/\n{3,}/g, '\n\n');
}

const targetExists = fs.existsSync(targetEnv);
const currentEnv = targetExists ? parseEnvFile(targetEnv) : new Map();
const imported = new Map();
const conflicts = [];
const skipped = [];

for (const sourcePath of legacySources) {
  if (!fs.existsSync(sourcePath)) {
    skipped.push({ source: sourcePath, reason: 'missing' });
    continue;
  }
  const parsed = parseEnvFile(sourcePath);
  for (const [key, value] of parsed) {
    const normalized = normalizeKey(key);
    if (!shouldImport(key, value)) continue;
    const currentValue = (currentEnv.get(normalized) || '').trim();
    if (currentValue) {
      conflicts.push({ key: normalized, source: sourcePath, kept: 'target_env' });
      continue;
    }
    if (!imported.has(normalized)) {
      imported.set(normalized, value.trim());
    }
  }
}

const sortedImports = [...imported.entries()].sort((a, b) => a[0].localeCompare(b[0]));

console.log(`[legacy-import] mode=${mode}`);
console.log(`[legacy-import] target=${targetEnv}`);
console.log('[legacy-import] sources=');
for (const source of legacySources) console.log(`  - ${source}`);

if (sortedImports.length === 0) {
  console.log('[legacy-import] no new values to import');
} else {
  console.log('[legacy-import] values ready to import:');
  for (const [key, value] of sortedImports) {
    const masked = value.length <= 8 ? '***' : `${value.slice(0, 4)}***${value.slice(-4)}`;
    console.log(`  - ${key}=${masked}`);
  }
}

if (conflicts.length > 0) {
  console.log('[legacy-import] skipped because target env already has a value:');
  for (const conflict of conflicts.slice(0, 50)) {
    console.log(`  - ${conflict.key} (${conflict.source})`);
  }
}

if (mode === 'apply' && sortedImports.length > 0) {
  ensureParent(targetEnv);
  const currentContent = targetExists ? fs.readFileSync(targetEnv, 'utf8') : '';
  const nextContent = upsertEnvContent(currentContent, new Map(sortedImports));
  fs.writeFileSync(targetEnv, nextContent.endsWith('\n') ? nextContent : `${nextContent}\n`, 'utf8');
  console.log(`[legacy-import] applied ${sortedImports.length} values`);
}
NODE

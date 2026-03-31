import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

const dotenvCandidates = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
];

for (const candidate of dotenvCandidates) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate, override: false });
  }
}

const port = parseInt(process.env.PORT || '3001', 10);
const nodeEnv = process.env.NODE_ENV || 'development';
const defaultInternalUrl = nodeEnv === 'development' ? `http://localhost:${port}` : `http://hub-engine:${port}`;

const isTestEnv = nodeEnv === 'test';

function normalizeSecret(value: string | undefined): string {
  return (value || '').trim();
}

function assertStrongSecret(name: string, value: string, options?: { minLength?: number; blocked?: string[] }) {
  if (isTestEnv) return;
  const minLength = options?.minLength ?? 24;
  const blocked = new Set((options?.blocked || []).map((item) => item.trim()).filter(Boolean));
  const normalized = normalizeSecret(value);
  if (!normalized || normalized.length < minLength || blocked.has(normalized)) {
    throw new Error(`${name} is missing or too weak; set a non-default value in .env before starting infohub.`);
  }
}

const jwtSecret = normalizeSecret(process.env.JWT_SECRET);
const audioWebhookSecret = normalizeSecret(process.env.AUDIO_WEBHOOK_SECRET);
const internalApiKey = normalizeSecret(process.env.INTERNAL_API_KEY);

assertStrongSecret('JWT_SECRET', jwtSecret, {
  minLength: 32,
  blocked: ['dev_jwt_secret_change_me', 'change_me_jwt_secret_at_least_32_chars'],
});
assertStrongSecret('AUDIO_WEBHOOK_SECRET', audioWebhookSecret, {
  minLength: 32,
  blocked: ['change_me_audio_webhook_secret'],
});
assertStrongSecret('INTERNAL_API_KEY', internalApiKey, {
  minLength: 32,
  blocked: ['change_me_internal_api_key'],
});

export const config = {
  port,
  nodeEnv,

  database: {
    url: process.env.DATABASE_URL || 'postgres://postgres:infohub_dev_2026@localhost:5432/infohub',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  auth: {
    allowRegistration: process.env.ALLOW_REGISTRATION !== 'false',
  },

  rsshub: {
    baseUrl: process.env.RSSHUB_BASE_URL || 'http://localhost:1200',
  },

  changedetection: {
    url: process.env.CHANGEDETECTION_URL || 'http://localhost:5555',
    apiKey: process.env.CHANGEDETECTION_API_KEY || process.env.CHANGEDETECTION_ACCESS_TOKEN || '',
  },

  scrapling: {
    enabled: process.env.SCRAPLING_ENABLED !== 'false',
    url: process.env.SCRAPLING_SERVICE_URL || 'http://scrapling-service:8010',
    timeoutMs: parseInt(process.env.SCRAPLING_TIMEOUT_MS || '20000', 10),
  },

  browserAssist: {
    enabled: process.env.BROWSER_ASSIST_ENABLED === 'true',
    url: process.env.BROWSER_ASSIST_URL || '',
    token: process.env.BROWSER_ASSIST_TOKEN || '',
    provider: process.env.BROWSER_ASSIST_PROVIDER || 'generic',
    timeoutMs: parseInt(process.env.BROWSER_ASSIST_TIMEOUT_MS || '25000', 10),
  },

  ntfy: {
    url: process.env.NTFY_URL || 'http://localhost:8081',
    topic: process.env.NTFY_TOPIC || 'infohub',
  },

  feishu: {
    webhookUrl: process.env.FEISHU_WEBHOOK_URL || '',
  },

  audio: {
    serviceUrl: process.env.AUDIO_SERVICE_URL || 'http://audio-service:8000',
    callbackBaseUrl: process.env.HUB_ENGINE_INTERNAL_URL || defaultInternalUrl,
    webhookSecret: audioWebhookSecret,
    internalApiKey,
    timeoutMs: parseInt(process.env.AUDIO_SERVICE_TIMEOUT_MS || '20000', 10),
    storageBackend: process.env.AUDIO_STORAGE_BACKEND || 'local',
  },

  storage: {
    hostDataRoot: process.env.HOST_DATA_ROOT || './data',
    hostExportRoot: process.env.HOST_EXPORT_ROOT || './exports',
    hostBackupRoot: process.env.HOST_BACKUP_ROOT || './backups',
    backupLocalDir: process.env.BACKUP_LOCAL_DIR || '/app/backups',
    backupStatusFile: process.env.BACKUP_STATUS_FILE || '/app/backups/backup-status.json',
    backupLocalRetention: parseInt(process.env.BACKUP_LOCAL_RETENTION || '7', 10),
    backupOssEnabled: process.env.BACKUP_OSS_ENABLED === 'true',
    backupOssBucket: process.env.BACKUP_OSS_BUCKET || '',
    backupOssPrefix: process.env.BACKUP_OSS_PREFIX || 'infohub-v3/',
    backupOssRegion: process.env.BACKUP_OSS_REGION || 'cn-beijing',
    backupOssRetention: parseInt(process.env.BACKUP_OSS_RETENTION || '30', 10),
  },

  fetch: {
    concurrency: parseInt(process.env.FETCH_CONCURRENCY || '5', 10),
    timeoutMs: parseInt(process.env.FETCH_TIMEOUT_MS || '30000', 10),
    userAgent: 'InfoHub/3.0 (+https://github.com/infohub)',
  },

  ai: {
    enabled: process.env.AI_PROCESSING_ENABLED !== 'false',
    scoringEnabled: process.env.AI_SCORING_ENABLED !== 'false',
    summaryEnabled: process.env.AI_SUMMARY_ENABLED !== 'false',
    translationEnabled: process.env.AI_TRANSLATION_ENABLED !== 'false',
  },
} as const;

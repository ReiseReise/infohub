import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Hono } from 'hono';
import { config } from '../config/index.js';
import { requireAuth } from '../lib/auth.js';

const app = new Hono();

type StoredBackupStatus = {
  updatedAt?: string;
  status?: string;
  durationMs?: number;
  message?: string;
  backupDir?: string;
  manualCommand?: string;
  bundle?: {
    name?: string | null;
    path?: string | null;
    sizeBytes?: number | null;
  } | null;
  localRetention?: number;
  localPruned?: string[];
  remote?: {
    enabled?: boolean;
    configured?: boolean;
    status?: string;
    bucket?: string | null;
    prefix?: string | null;
    objectKey?: string | null;
    uploadedAt?: string | null;
    prunedKeys?: string[];
    error?: string | null;
  } | null;
};

async function readBackupStatus(): Promise<StoredBackupStatus | null> {
  const statusPath = config.storage.backupStatusFile;
  if (!existsSync(statusPath)) return null;
  try {
    const raw = await readFile(statusPath, 'utf-8');
    return JSON.parse(raw) as StoredBackupStatus;
  } catch {
    return null;
  }
}

async function listLocalBundles() {
  const backupDir = config.storage.backupLocalDir;
  if (!existsSync(backupDir)) return [];
  const entries = await readdir(backupDir);
  const bundles = await Promise.all(
    entries
      .filter((name) => /^infohub-v3-portable-.*\.tar\.gz$/.test(name))
      .map(async (name) => {
        const fullPath = resolve(backupDir, name);
        const fileStat = await stat(fullPath);
        return {
          name,
          path: fullPath,
          sizeBytes: fileStat.size,
          updatedAt: fileStat.mtime.toISOString(),
        };
      }),
  );

  return bundles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);
}

app.get('/status', async (c) => {
  const authUser = requireAuth(c);
  if (authUser.role !== 'admin') {
    return c.json({ error: 'Only admin can view storage status' }, 403);
  }

  const [storedStatus, localBundles] = await Promise.all([
    readBackupStatus(),
    listLocalBundles(),
  ]);

  return c.json({
    data: {
      storage: {
        hostDataRoot: config.storage.hostDataRoot,
        hostExportRoot: config.storage.hostExportRoot,
        hostBackupRoot: config.storage.hostBackupRoot,
        runtimePaths: {
          postgres: `${config.storage.hostDataRoot}/pg`,
          redis: `${config.storage.hostDataRoot}/redis`,
          knowledge: `${config.storage.hostDataRoot}/knowledge`,
          audioUploads: `${config.storage.hostDataRoot}/audio-uploads`,
          changedetection: `${config.storage.hostDataRoot}/changedetection`,
          ntfy: `${config.storage.hostDataRoot}/ntfy`,
          exports: config.storage.hostExportRoot,
          backups: config.storage.hostBackupRoot,
        },
        audioStorageBackend: config.audio.storageBackend,
        syncGuidance: [
          { path: `${config.storage.hostDataRoot}/pg`, mode: 'backup_only', reason: 'Postgres 原始数据目录，不建议云盘实时同步' },
          { path: `${config.storage.hostDataRoot}/redis`, mode: 'backup_only', reason: 'Redis 持久化目录，不建议云盘实时同步' },
          { path: `${config.storage.hostDataRoot}/knowledge`, mode: 'sync_ok', reason: '知识库文本文件，可按需同步' },
          { path: config.storage.hostExportRoot, mode: 'sync_ok', reason: '导出物目录，适合同步到本地网盘' },
          { path: config.storage.hostBackupRoot, mode: 'archive_only', reason: '快照目录，建议做对象存储归档' },
        ],
      },
      backup: {
        localDir: config.storage.backupLocalDir,
        statusFile: config.storage.backupStatusFile,
        localRetention: config.storage.backupLocalRetention,
        oss: {
          enabled: config.storage.backupOssEnabled,
          bucket: config.storage.backupOssBucket || null,
          prefix: config.storage.backupOssPrefix,
          region: config.storage.backupOssRegion,
          retention: config.storage.backupOssRetention,
        },
        lastRun: storedStatus,
        localBundles,
        localBundleCount: localBundles.length,
        latestBundleName: storedStatus?.bundle?.name || localBundles[0]?.name || null,
        latestBundleBasename: storedStatus?.bundle?.path ? basename(storedStatus.bundle.path) : (localBundles[0]?.name || null),
        manualCommand: storedStatus?.manualCommand || 'bash scripts/portable/backup-archive.sh',
      },
    },
  });
});

export default app;

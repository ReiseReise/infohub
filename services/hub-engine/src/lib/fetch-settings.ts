import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export interface UserFetchSettings {
  userId: string;
  autoFetchEnabled: boolean;
  autoSummaryEnabled: boolean;
  autoTranslationEnabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export const DEFAULT_USER_FETCH_SETTINGS = {
  autoFetchEnabled: true,
  autoSummaryEnabled: true,
  autoTranslationEnabled: true,
} as const;

export function normalizeUserFetchSettings(
  userId: string,
  row?: Partial<typeof schema.userSettings.$inferSelect> | null,
): UserFetchSettings {
  return {
    userId,
    autoFetchEnabled: row?.autoFetchEnabled ?? DEFAULT_USER_FETCH_SETTINGS.autoFetchEnabled,
    autoSummaryEnabled: row?.autoSummaryEnabled ?? DEFAULT_USER_FETCH_SETTINGS.autoSummaryEnabled,
    autoTranslationEnabled: row?.autoTranslationEnabled ?? DEFAULT_USER_FETCH_SETTINGS.autoTranslationEnabled,
    createdAt: row?.createdAt,
    updatedAt: row?.updatedAt,
  };
}

export async function getUserFetchSettings(userId: string): Promise<UserFetchSettings> {
  const rows = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1);

  return normalizeUserFetchSettings(userId, rows[0]);
}

export async function upsertUserFetchSettings(
  userId: string,
  patch: Partial<Pick<UserFetchSettings, 'autoFetchEnabled' | 'autoSummaryEnabled' | 'autoTranslationEnabled'>>,
): Promise<UserFetchSettings> {
  const current = await getUserFetchSettings(userId);
  const next = {
    autoFetchEnabled: patch.autoFetchEnabled ?? current.autoFetchEnabled,
    autoSummaryEnabled: patch.autoSummaryEnabled ?? current.autoSummaryEnabled,
    autoTranslationEnabled: patch.autoTranslationEnabled ?? current.autoTranslationEnabled,
  };
  const rows = await db
    .insert(schema.userSettings)
    .values({
      userId,
      ...next,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.userSettings.userId,
      set: {
        ...next,
        updatedAt: new Date(),
      },
    })
    .returning();

  return normalizeUserFetchSettings(userId, rows[0]);
}

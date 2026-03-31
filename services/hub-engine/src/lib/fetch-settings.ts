import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export interface UserFetchSettings {
  userId: string;
  autoFetchEnabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export async function getUserFetchSettings(userId: string): Promise<UserFetchSettings> {
  const rows = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return {
      userId,
      autoFetchEnabled: true,
    };
  }

  return {
    userId: row.userId,
    autoFetchEnabled: Boolean(row.autoFetchEnabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function upsertUserFetchSettings(
  userId: string,
  patch: Partial<Pick<UserFetchSettings, 'autoFetchEnabled'>>,
): Promise<UserFetchSettings> {
  const nextAutoFetchEnabled = patch.autoFetchEnabled ?? true;
  const rows = await db
    .insert(schema.userSettings)
    .values({
      userId,
      autoFetchEnabled: nextAutoFetchEnabled,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.userSettings.userId,
      set: {
        autoFetchEnabled: nextAutoFetchEnabled,
        updatedAt: new Date(),
      },
    })
    .returning();

  const row = rows[0];
  return {
    userId: row.userId,
    autoFetchEnabled: Boolean(row.autoFetchEnabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export interface UserDailyReportSettings {
  userId: string;
  dailyReportEnabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export async function getUserDailyReportSettings(userId: string): Promise<UserDailyReportSettings> {
  const rows = await db
    .select({
      userId: schema.userSettings.userId,
      dailyReportEnabled: schema.userSettings.dailyReportEnabled,
      createdAt: schema.userSettings.createdAt,
      updatedAt: schema.userSettings.updatedAt,
    })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { userId, dailyReportEnabled: false };
  }

  return {
    userId: row.userId,
    dailyReportEnabled: Boolean(row.dailyReportEnabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function upsertUserDailyReportSettings(
  userId: string,
  dailyReportEnabled: boolean,
): Promise<UserDailyReportSettings> {
  const rows = await db
    .insert(schema.userSettings)
    .values({
      userId,
      dailyReportEnabled,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.userSettings.userId,
      set: {
        dailyReportEnabled,
        updatedAt: new Date(),
      },
    })
    .returning({
      userId: schema.userSettings.userId,
      dailyReportEnabled: schema.userSettings.dailyReportEnabled,
      createdAt: schema.userSettings.createdAt,
      updatedAt: schema.userSettings.updatedAt,
    });

  const row = rows[0];
  return {
    userId: row.userId,
    dailyReportEnabled: Boolean(row.dailyReportEnabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

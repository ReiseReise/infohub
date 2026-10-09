export const DEFAULT_DAILY_REPORT_HOUR = 6;
export const DEFAULT_DAILY_CATCH_UP_DAYS = 7;
export const DEFAULT_DAILY_REPORT_TIME_ZONE = 'Asia/Shanghai';
export type DailyGenerationPublicStatus = 'scheduled' | 'running' | 'full' | 'degraded' | 'failed';

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const values = new Map(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
    second: Number(values.get('second')),
  };
}

function calendarDate(parts: Pick<ZonedDateParts, 'year' | 'month' | 'day'>, dayOffset = 0) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date;
}

function dateKeyFromCalendarDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function localDateTimeToUtc(
  parts: Pick<ZonedDateParts, 'year' | 'month' | 'day'> & { hour: number },
  timeZone: string,
) {
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, 0, 0, 0);
  let guess = localAsUtc;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actual = getZonedDateParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess -= actualAsUtc - localAsUtc;
  }
  return new Date(guess);
}

export function getDailyReportDateKey(now = new Date(), timeZone = DEFAULT_DAILY_REPORT_TIME_ZONE) {
  return dateKeyFromCalendarDate(calendarDate(getZonedDateParts(now, timeZone)));
}

export function resolveDailyGenerationPublicStatus(
  queueState: string,
  result?: { qualityStatus?: string | null } | null,
): DailyGenerationPublicStatus {
  if (queueState === 'failed') return 'failed';
  if (queueState === 'completed') return result?.qualityStatus === 'degraded' ? 'degraded' : 'full';
  if (queueState === 'active') return 'running';
  return 'scheduled';
}

export function shouldReuseExistingDailyReport(input: {
  qualityStatus?: string | null;
  savedItemCount?: number | null;
  currentItemCount: number;
  savedReadyCount?: number | null;
  currentReadyCount?: number | null;
  savedMaterialFingerprint?: string | null;
  currentMaterialFingerprint?: string | null;
}) {
  if (input.qualityStatus === 'full') return true;
  const savedItemCount = Math.max(0, Number(input.savedItemCount || 0));
  const currentItemCount = Math.max(0, Number(input.currentItemCount || 0));
  if (currentItemCount > savedItemCount) return false;

  const savedReadyCount = Math.max(0, Number(input.savedReadyCount || 0));
  const currentReadyCount = Math.max(0, Number(input.currentReadyCount || 0));
  if (currentReadyCount > savedReadyCount) return false;

  const savedFingerprint = String(input.savedMaterialFingerprint || '').trim();
  const currentFingerprint = String(input.currentMaterialFingerprint || '').trim();
  if (savedFingerprint && currentFingerprint) {
    return savedFingerprint === currentFingerprint;
  }
  return true;
}

export function buildDailyReportJobId(
  userId: string,
  dateKey: string,
  mode: 'fast' | 'full',
  preset: 'full' | 'decision' | 'research' | 'reading',
  sourceId?: number | null,
) {
  return `daily_report_${userId}_${dateKey}_${mode}_${preset}_${sourceId || 'all'}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function buildDailyCatchUpDateKeys(
  now = new Date(),
  days = DEFAULT_DAILY_CATCH_UP_DAYS,
  scheduledHour = DEFAULT_DAILY_REPORT_HOUR,
  timeZone = DEFAULT_DAILY_REPORT_TIME_ZONE,
): string[] {
  const boundedDays = Math.max(1, Math.min(31, Math.floor(days)));
  const parts = getZonedDateParts(now, timeZone);
  const latestEligible = calendarDate(parts, parts.hour < scheduledHour ? -1 : 0);
  const dates: string[] = [];
  for (let offset = boundedDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(latestEligible);
    date.setUTCDate(date.getUTCDate() - offset);
    dates.push(dateKeyFromCalendarDate(date));
  }
  return dates;
}

export function resolveDailyRecoveryCheck(
  lastCheckedKey: string | null,
  now = new Date(),
  scheduledHour = DEFAULT_DAILY_REPORT_HOUR,
  timeZone = DEFAULT_DAILY_REPORT_TIME_ZONE,
  intervalMinutes = 15,
) {
  const dateKey = buildDailyCatchUpDateKeys(now, 1, scheduledHour, timeZone)[0];
  const boundedInterval = Math.max(1, Math.min(60, Math.floor(intervalMinutes)));
  const intervalMs = boundedInterval * 60 * 1000;
  const checkKey = `${dateKey}:${Math.floor(now.getTime() / intervalMs)}`;
  return {
    dateKey,
    checkKey,
    shouldRun: checkKey !== lastCheckedKey,
  };
}

export function getNextDailyScheduleAt(
  now = new Date(),
  scheduledHour = DEFAULT_DAILY_REPORT_HOUR,
  timeZone = DEFAULT_DAILY_REPORT_TIME_ZONE,
): Date {
  const parts = getZonedDateParts(now, timeZone);
  let targetDate = calendarDate(parts);
  let next = localDateTimeToUtc({
    year: targetDate.getUTCFullYear(),
    month: targetDate.getUTCMonth() + 1,
    day: targetDate.getUTCDate(),
    hour: scheduledHour,
  }, timeZone);
  if (next.getTime() <= now.getTime()) {
    targetDate = calendarDate(parts, 1);
    next = localDateTimeToUtc({
      year: targetDate.getUTCFullYear(),
      month: targetDate.getUTCMonth() + 1,
      day: targetDate.getUTCDate(),
      hour: scheduledHour,
    }, timeZone);
  }
  return next;
}

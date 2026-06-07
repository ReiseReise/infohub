export type DailyReportWindow = {
  dateKey: string;
  dayStart: Date;
  dayEnd: Date;
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function dateKeyFromLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateKey(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export function resolveDailyReportWindow(input?: Date | string | null): DailyReportWindow {
  const base = typeof input === 'string'
    ? parseDateKey(input)
    : input instanceof Date
      ? input
      : new Date();
  if (!base || Number.isNaN(base.getTime())) {
    throw new Error('invalid_daily_report_date');
  }
  const dayStart = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return {
    dateKey: dateKeyFromLocalDate(dayStart),
    dayStart,
    dayEnd,
  };
}

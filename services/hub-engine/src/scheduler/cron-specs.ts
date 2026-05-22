export interface CronJobSchedule {
  name: string;
  schedule: string;
}

export const CRON_JOB_SCHEDULES: CronJobSchedule[] = [
  { name: 'hybrid-fetch', schedule: '*/5 * * * *' },
  { name: 'ai-processing', schedule: '*/10 * * * *' },
  { name: 'priority-update', schedule: '15,45 * * * *' },
  { name: 'daily-report', schedule: '0 6 * * *' },
  { name: 'retention-cleanup', schedule: '30 3 * * *' },
  { name: 'preference-profile-rebuild', schedule: '15 2 * * *' },
];

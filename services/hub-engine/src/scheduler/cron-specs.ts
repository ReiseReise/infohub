export interface CronJobSchedule {
  name: string;
  schedule: string;
}

export const CRON_JOB_SCHEDULES: CronJobSchedule[] = [
  { name: 'hybrid-fetch', schedule: '*/5 * * * *' },
  { name: 'ai-processing', schedule: '*/10 * * * *' },
  { name: 'processing-debt-recovery', schedule: '3,18,33,48 * * * *' },
  { name: 'priority-update', schedule: '15,45 * * * *' },
  { name: 'daily-report-recovery', schedule: '*/15 * * * *' },
  { name: 'retention-cleanup', schedule: '30 3 * * *' },
  { name: 'preference-profile-rebuild', schedule: '15 2 * * *' },
];

export function getCronJobSchedule(name: string): CronJobSchedule {
  const job = CRON_JOB_SCHEDULES.find((candidate) => candidate.name === name);
  if (!job) throw new Error(`Unknown cron job: ${name}`);
  return job;
}

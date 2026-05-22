import test from 'node:test';
import assert from 'node:assert/strict';
import { CRON_JOB_SCHEDULES } from './cron-specs.js';

test('cron job specs expose the expected schedules without starting jobs', () => {
  assert.deepEqual(
    CRON_JOB_SCHEDULES.map((job) => [job.name, job.schedule]),
    [
      ['hybrid-fetch', '*/5 * * * *'],
      ['ai-processing', '*/10 * * * *'],
      ['priority-update', '15,45 * * * *'],
      ['daily-report', '0 6 * * *'],
      ['retention-cleanup', '30 3 * * *'],
      ['preference-profile-rebuild', '15 2 * * *'],
    ],
  );
});

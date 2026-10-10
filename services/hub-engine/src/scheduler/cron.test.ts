import test from 'node:test';
import assert from 'node:assert/strict';
import cron from 'node-cron';
import { CRON_JOB_SCHEDULES } from './cron-specs.js';

test('cron job specs expose the expected schedules without starting jobs', () => {
  assert.deepEqual(
    CRON_JOB_SCHEDULES.map((job) => [job.name, job.schedule]),
    [
      ['hybrid-fetch', '*/5 * * * *'],
      ['ai-processing', '*/10 * * * *'],
      ['processing-debt-recovery', '3,18,33,48 * * * *'],
      ['priority-update', '15,45 * * * *'],
      ['daily-report-recovery', '*/15 * * * *'],
      ['retention-cleanup', '30 3 * * *'],
      ['preference-profile-rebuild', '15 2 * * *'],
    ],
  );
  for (const job of CRON_JOB_SCHEDULES) {
    assert.equal(cron.validate(job.schedule), true, `${job.name} must use a valid node-cron expression`);
  }
});

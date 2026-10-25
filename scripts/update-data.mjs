import { appendFile } from 'node:fs/promises';
import { selectUpdateSources, updateData } from './lib/data-automation.mjs';
import { updateSummary } from './lib/update-summary.mjs';
import { d4Config } from './lib/d4-acceptance.mjs';
import { externalScheduleRequested } from './lib/external-schedule.mjs';
import { scheduledMode } from './lib/schedule-mode.mjs';
try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--scheduled' && !arg.startsWith('--sources='))) throw Error('Invalid arguments');
  const selected = args.find(arg => arg.startsWith('--sources='));
  if (externalScheduleRequested(process.env) && selected && selected !== '--sources=core') throw Error('external_schedule_invalid');
  const scheduled = args.includes('--scheduled') || externalScheduleRequested(process.env);
  const mode = scheduled ? scheduledMode(process.env) : null;
  const deadline = mode === 'd4' ? Date.parse(d4Config(process.env.D4_CONFIG).deadline) : undefined;
  const startBy = deadline == null ? undefined : deadline - 20 * 60000;
  const report = await updateData({ sources: selectUpdateSources(selected ? selected.slice(10) : 'all', scheduled), scheduled, cron: scheduled ? process.env.SCHEDULE_CRON : undefined, deadline, startBy });
  console.log(JSON.stringify(report, null, 2)); // Only allowlisted fields and controlled error codes.
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${report.changed}\nfailed=${report.failed}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, updateSummary(report));
  if (report.failed) process.exitCode = 2; // Valid sources already saved; CI explicitly handles partial failures.
} catch { console.error('Data update stopped: lock, state, arguments or filesystem invalid. No raw errors are logged.'); process.exitCode = 1; }

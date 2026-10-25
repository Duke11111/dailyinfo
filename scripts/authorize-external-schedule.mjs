import { assertExternalScheduleInputs } from './lib/external-schedule.mjs';
import { scheduledMode } from './lib/schedule-mode.mjs';
try {
  if (assertExternalScheduleInputs(process.env)) scheduledMode(process.env);
} catch {
  console.error('External schedule refused: authorization or inputs invalid.');
  process.exitCode = 1;
}

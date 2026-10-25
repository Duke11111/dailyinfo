// Explicit dispatch input, never infer automation from the actor or token identity.
export const externalScheduleRequested = env => env.EXTERNAL_SCHEDULE === 'true';
export function assertExternalScheduleInputs(env) {
  if (env.EXTERNAL_SCHEDULE == null || env.EXTERNAL_SCHEDULE === '' || env.EXTERNAL_SCHEDULE === 'false') return false;
  if (!externalScheduleRequested(env) || (env.GITHUB_EVENT_NAME ?? env.EVENT) !== 'workflow_dispatch'
    || env.SOURCE !== 'core' || env.INITIALIZE_STATE !== 'false' || env.INITIALIZE_MANIFEST !== 'false'
    || env.PUBLISH_CURRENT !== 'false' || env.CHECKPOINT_ONLY !== 'false'
    || (env.BASELINE_APPROVAL ?? '') !== '' || (env.APPROVED_CHECKPOINT_RUN ?? '') !== '') {
    throw Error('external_schedule_invalid');
  }
  return true;
}

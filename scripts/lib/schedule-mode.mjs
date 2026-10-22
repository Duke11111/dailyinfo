// A fresh, explicit mode opt-in separates bounded D4 acceptance from long-term updates.
export function scheduledMode(env) {
  if (env.GITHUB_EVENT_NAME !== 'schedule' || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_REPOSITORY !== 'Duke11111/dailyinfo' || env.GITHUB_RUN_ATTEMPT !== '1'
    || env.AUTOMATION !== 'true' || env.SCHEDULE !== 'true' || env.FREE !== 'true'
    || !['d4', 'continuous'].includes(env.SCHEDULE_MODE)
    || !['37 2 * * *', '43 12 * * *', '47 14 * * *'].includes(env.SCHEDULE_CRON)
    || env.SCHEDULE_MODE === 'd4' && (env.SCHEDULE_CRON !== '43 12 * * *' || !env.D4_CONFIG)) {
    throw Error('schedule_not_authorized');
  }
  return env.SCHEDULE_MODE;
}

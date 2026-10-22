import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { scheduledMode } from '../scripts/lib/schedule-mode.mjs';
const workflow = (await readFile('.github/workflows/data-update.yml', 'utf8')).replace(/\r\n/g, '\n');
const env = () => ({ GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'Duke11111/dailyinfo',
  GITHUB_RUN_ATTEMPT: '1', AUTOMATION: 'true', SCHEDULE: 'true', FREE: 'true', SCHEDULE_MODE: 'continuous', SCHEDULE_CRON: '43 12 * * *' });
const vars = () => ({ DATA_AUTOMATION_ENABLED: 'true', DATA_SCHEDULE_ENABLED: 'true', DATA_FREE_USAGE_CONFIRMED: 'true',
  DATA_SCHEDULE_MODE: 'continuous', DATA_AUTO_PUBLISH_ENABLED: 'true', DATA_PUBLISH_ENABLED: 'true', DATA_DEPLOY_TARGET: 'pages' });
const github = () => ({ event_name: 'schedule', ref: 'refs/heads/main', run_attempt: 1,
  event: { schedule: '43 12 * * *', repository: { visibility: 'public', default_branch: 'main' } } });
function gate(job, v = vars(), g = github(), needs = { update: { outputs: { publish: 'true' } } }) {
  const expression = workflow.split(`  ${job}:\n`)[1].match(/^    if: (.+)$/m)[1];
  return Boolean(Function('vars', 'github', 'needs', 'always', 'format', 'fromJSON', `return (${expression});`)(
    v, g, needs, () => true, (pattern, value) => pattern.replace('{0}', value), JSON.parse));
}
it.each(['37 2 * * *', '43 12 * * *', '47 14 * * *'])('continuous %s ignores stale D4 configuration and can update', cron => {
  expect(scheduledMode({ ...env(), SCHEDULE_CRON: cron, D4_CONFIG: '{expired invalid D4}' })).toBe('continuous');
  expect(gate('update', { ...vars(), DATA_D4_ONCE: '{expired invalid D4}' }, { ...github(), event: { ...github().event, schedule: cron } })).toBe(true);
});
it.each([undefined, '', 'D4', 'CONTINUOUS', 'other'])('invalid/unset mode %s cannot start sources', mode => {
  expect(() => scheduledMode({ ...env(), SCHEDULE_MODE: mode })).toThrow('schedule_not_authorized');
  expect(gate('update', { ...vars(), DATA_SCHEDULE_MODE: mode })).toBe(false);
});
it.each(['AUTOMATION', 'SCHEDULE', 'FREE'])('missing or noncanonical %s blocks source execution', key => {
  for (const value of [undefined, '', 'false', 'TRUE']) expect(() => scheduledMode({ ...env(), [key]: value })).toThrow();
});
it.each(['GITHUB_EVENT_NAME', 'GITHUB_REF', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ATTEMPT', 'SCHEDULE_CRON'])('invalid %s blocks source execution', key => {
  expect(() => scheduledMode({ ...env(), [key]: 'invalid' })).toThrow();
});
it('D4 requires evening configuration, never schedules publication, and cannot be rerun', () => {
  const v = { ...vars(), DATA_SCHEDULE_MODE: 'd4', DATA_D4_ONCE: '{}' };
  expect(scheduledMode({ ...env(), SCHEDULE_MODE: 'd4', D4_CONFIG: '{}' })).toBe('d4');
  expect(() => scheduledMode({ ...env(), SCHEDULE_MODE: 'd4' })).toThrow();
  expect(gate('update', v)).toBe(true); expect(gate('deploy', v)).toBe(false);
  for (const cron of ['37 2 * * *', '47 14 * * *']) {
    expect(() => scheduledMode({ ...env(), SCHEDULE_MODE: 'd4', D4_CONFIG: '{}', SCHEDULE_CRON: cron })).toThrow();
    expect(gate('update', v, { ...github(), event: { ...github().event, schedule: cron } })).toBe(false);
  }
  expect(gate('update', vars(), { ...github(), run_attempt: 2 })).toBe(false);
  expect(() => scheduledMode({ ...env(), GITHUB_RUN_ATTEMPT: '2' })).toThrow();
});
it.each(['DATA_AUTOMATION_ENABLED', 'DATA_SCHEDULE_ENABLED', 'DATA_FREE_USAGE_CONFIRMED', 'DATA_AUTO_PUBLISH_ENABLED', 'DATA_PUBLISH_ENABLED', 'DATA_DEPLOY_TARGET', 'DATA_SCHEDULE_MODE'])('scheduled deployment requires %s independently', key => {
  expect(gate('deploy')).toBe(true);
  for (const value of [undefined, '', 'false']) expect(gate('deploy', { ...vars(), [key]: value })).toBe(false);
});
it('no changed candidate means no deploy; manual publication does not inherit auto authorization', () => {
  expect(gate('deploy', vars(), github(), { update: { outputs: { publish: 'false' } } })).toBe(false);
  const manual = { ...github(), event_name: 'workflow_dispatch' };
  expect(gate('update', { DATA_AUTOMATION_ENABLED: 'true' }, manual)).toBe(true);
  expect(gate('deploy', { DATA_PUBLISH_ENABLED: 'true', DATA_DEPLOY_TARGET: 'pages' }, manual)).toBe(true);
  // The decision output is false unless manual publish_current was explicitly authorized.
  expect(gate('deploy', vars(), manual, { update: { outputs: { publish: 'false' } } })).toBe(false);
});
it('D4-only steps and configuration cannot leak into continuous updates; restore checks mode before API', async () => {
  expect(workflow).toContain("D4_CONFIG: ${{ vars.DATA_SCHEDULE_MODE == 'd4' && vars.DATA_D4_ONCE || '' }}");
  const names = ['Admit one scheduled attempt', 'Persist single-use claim', 'Capture restored source', 'Preserve source acceptance', 'Upload bounded acceptance'];
  for (const name of names) {
    const step = workflow.split('      - name: ').find(text => text.startsWith(name));
    expect(step).toContain("if: github.event_name == 'schedule' && vars.DATA_SCHEDULE_MODE == 'd4'");
  }
  expect(workflow.split('  d4-acceptance:\n')[1]).toContain("vars.DATA_SCHEDULE_MODE == 'd4'");
  const restore = await readFile('scripts/automation-state.mjs', 'utf8');
  expect(restore.indexOf('scheduledMode(process.env)')).toBeLessThan(restore.indexOf("await gh(['api'"));
  expect(restore).toContain("if (schedule === 'd4') assertD4Checkpoint");
  const updater = await readFile('scripts/update-data.mjs', 'utf8');
  expect(updater).toContain("mode === 'd4' ? Date.parse(d4Config(process.env.D4_CONFIG).deadline) : undefined");
});

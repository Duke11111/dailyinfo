import { it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { isDue, CORE_SOURCES } from '../scripts/lib/data-automation.mjs';
import { selectCheckpoint } from '../scripts/lib/checkpoint-policy.mjs';

const workflow = await readFile('.github/workflows/data-update.yml', 'utf8');
const update = workflow.split('\n  update:')[1].split('\n  deploy:')[0];
const context = (event = 'schedule', variables = {}, inputs = {}) => ({
  vars: { DATA_AUTOMATION_ENABLED: 'true', DATA_FREE_USAGE_CONFIRMED: 'true', ...variables }, inputs,
  github: { event_name: event, ref: 'refs/heads/main', event: { repository: { default_branch: 'main' } } },
  format: (pattern, value) => pattern.replace('{0}', value),
  fromJSON: JSON.parse,
});
// Evaluate the actual workflow condition, not a duplicate policy implementation.
function evaluate(expression, values) {
  // GitHub string equality ignores case; model that explicitly for the schedule switch.
  const githubExpression = expression.replace("vars.DATA_SCHEDULE_ENABLED == 'true'", "String(vars.DATA_SCHEDULE_ENABLED).toLowerCase() == 'true'");
  return runInNewContext(githubExpression, values, { timeout: 100 });
}
const updateCondition = update.match(/^    if: (.+)$/m)[1];
const deployCondition = workflow.split('\n  deploy:')[1].match(/^    if: (.+)$/m)[1];
const initialize = update.match(/INITIALIZE_STATE: \$\{\{ (.+) \}\}/)[1];

it.each([undefined, '', 'false', '1'])('skips the entire scheduled update job for switch %s', value => {
  expect(evaluate(updateCondition, context('schedule', { DATA_SCHEDULE_ENABLED: value }))).toBe(false);
});
it('fails closed on a noncanonical TRUE instead of accepting GitHub case-insensitive equality', () => {
  expect(() => evaluate(updateCondition, context('schedule', { DATA_SCHEDULE_ENABLED: 'TRUE' }))).toThrow();
  expect(evaluate(updateCondition, context('workflow_dispatch', { DATA_SCHEDULE_ENABLED: 'TRUE' }))).toBe(true);
});
it('requires both switches, manual/default branch policy and a supported event', () => {
  const values = context('schedule', { DATA_SCHEDULE_ENABLED: 'true' });
  expect(evaluate(updateCondition, values)).toBe(true);
  expect(evaluate(updateCondition, context('schedule', { DATA_SCHEDULE_ENABLED: 'true', DATA_AUTOMATION_ENABLED: 'false' }))).toBe(false);
  values.github.ref = 'refs/heads/feature'; expect(evaluate(updateCondition, values)).toBe(false);
  values.github.event.repository.default_branch = 'feature'; expect(evaluate(updateCondition, values)).toBe(false);
  expect(evaluate(updateCondition, context('push', { DATA_SCHEDULE_ENABLED: 'true' }))).toBe(false);
});
it('requires explicit free-usage review before a schedule can start a runner', () => {
  for (const value of [undefined, '', 'false']) expect(evaluate(updateCondition,
    context('schedule', { DATA_SCHEDULE_ENABLED: 'true', DATA_FREE_USAGE_CONFIRMED: value }))).toBe(false);
});
it.each(['all', 'core', 'quotes', 'checkpoint'])('preserves manual %s with the schedule switch disabled', source => {
  for (const value of [undefined, 'false', 'true']) expect(evaluate(updateCondition, context('workflow_dispatch', { DATA_SCHEDULE_ENABLED: value }, { source }))).toBe(true);
});
it('makes initialization impossible for schedules while preserving explicit manual initialization', () => {
  expect(evaluate(initialize, context('schedule', {}, { initialize_state: true }))).toBe('false');
  expect(evaluate(initialize, context('workflow_dispatch', {}, { initialize_state: true }))).toBe('true');
  expect(evaluate(initialize, context('workflow_dispatch', {}, { initialize_state: false }))).toBe('false');
});
it.each(['skipped', 'failure', 'cancelled'])('does not save a checkpoint after an update job is %s', result => {
  const condition = workflow.split('\n  checkpoint:')[1].match(/^    if: (.+)$/m)[1];
  expect(evaluate(condition, { always: () => true, needs: { update: { result }, deploy: { result: 'skipped' } } })).toBe(false);
});
it.each([[undefined, undefined, false], ['false', 'pages', false], ['true', undefined, false], ['true', 'other', false], ['true', 'pages', true]])('gates Pages on explicit publish %s and target %s', (enabled, target, expected) => {
  const values = { vars: { DATA_PUBLISH_ENABLED: enabled, DATA_DEPLOY_TARGET: target }, needs: { update: { outputs: { publish: 'true' } } } };
  expect(evaluate(deployCondition, values)).toBe(expected);
  values.needs.update.outputs.publish = 'false'; expect(evaluate(deployCondition, values)).toBe(false);
  expect(workflow).toContain("if: steps.decision.outputs.publish == 'true'");
});
it('uses three Taipei windows and only core --scheduled in the scheduled branch', () => {
  expect([...workflow.matchAll(/- cron: '([^']+)'/g)].map(match => match[1])).toEqual(['37 2 * * *', '43 12 * * *', '47 14 * * *']);
  expect(workflow).toContain('SCHEDULE_CRON: ${{ github.event.schedule }}');
  const scheduled = update.split('if [ "$EVENT" = "schedule" ]; then')[1].split('elif')[0];
  expect(scheduled.trim()).toBe('npm run update:data -- --sources=core --scheduled');
  expect(CORE_SOURCES).toEqual(['quotes', 'news', 'earthquakes', 'horoscope']);
  expect(update).toContain('if: inputs.source != \'checkpoint\'');
});
it('uses Taiwan dates across UTC midnight, weekends and delayed runs', () => {
  const state = { version: 1, sources: { quotes: { attemptedAt: '2026-10-19T10:17:00Z' }, horoscope: { attemptedAt: '2026-10-19T10:17:00Z' } } };
  const taiwanMidnight = Date.parse('2026-10-19T16:17:00Z');
  expect(isDue('quotes', state, taiwanMidnight)).toBe(false);
  expect(isDue('horoscope', state, taiwanMidnight)).toBe(false);
  const nextEvening = Date.parse('2026-10-20T12:43:00Z');
  for (const source of CORE_SOURCES) expect(isDue(source, state, nextEvening)).toBe(true);
  const weekend = Date.parse('2026-10-24T12:43:00Z');
  expect(isDue('quotes', state, weekend)).toBe(false);
  for (const source of ['news', 'earthquakes', 'horoscope']) expect(isDue(source, state, weekend)).toBe(true);
  const lateNight = Date.parse('2026-10-20T15:59:00Z');
  expect(isDue('quotes', state, lateNight)).toBe(true);
});
it('refuses an expired checkpoint in ordinary scheduled restore without querying its run', async () => {
  const lookup = vi.fn();
  const selected = await selectCheckpoint([{ name: 'dailyinfo-data-state', expired: false, created_at: '2026-10-19T08:00:00Z', expires_at: '2026-10-20T10:17:00Z', workflow_run: { id: 123, head_branch: 'main' } }], lookup,
    { branch: 'main', now: Date.parse('2026-10-20T10:17:00Z') });
  expect(selected).toBeNull(); expect(lookup).not.toHaveBeenCalled();
  const restore = await readFile('scripts/automation-state.mjs', 'utf8');
  expect(restore).toContain("if (exact || process.env.INITIALIZE_STATE !== 'true') throw Error()");
});

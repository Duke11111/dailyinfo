import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { releaseDecision, assertArtifactBudget, ARTIFACT_LIMIT, UPLOAD_RESERVE } from '../scripts/lib/release-policy.mjs';
import { isDue } from '../scripts/lib/data-automation.mjs';

const permitted = { EVENT: 'schedule', DATA_CHANGED: 'true', AUTO_PUBLISH_ENABLED: 'true', FREE_USAGE_CONFIRMED: 'true', PUBLISH_ENABLED: 'true', DEPLOY_TARGET: 'pages' };
it('allows an authorized changed automatic release only', () => {
  expect(releaseDecision(permitted)).toEqual({ changed: true, publish: true });
});
it.each(['DATA_CHANGED', 'AUTO_PUBLISH_ENABLED', 'FREE_USAGE_CONFIRMED', 'PUBLISH_ENABLED', 'DEPLOY_TARGET'])('blocks automatic publication without %s', key => {
  expect(releaseDecision({ ...permitted, [key]: '' }).publish).toBe(false);
});
it('code changes or force-build cannot masquerade as fresh scheduled data', () => {
  expect(releaseDecision({ ...permitted, DATA_CHANGED: 'false', CODE_CHANGED: 'true', FORCE_BUILD: 'true' })).toEqual({ changed: true, publish: false });
});
it('manual updates need their own explicit publish_current approval', () => {
  expect(releaseDecision({ ...permitted, EVENT: 'workflow_dispatch' }).publish).toBe(false);
  expect(releaseDecision({ ...permitted, EVENT: 'workflow_dispatch', AUTO_PUBLISH_ENABLED: '', FORCE_BUILD: 'true' }).publish).toBe(true);
  expect(releaseDecision({ ...permitted, EVENT: 'push', FORCE_BUILD: 'true' }).publish).toBe(false);
});
it.each(['news', 'earthquakes'])('throttles %s to at least an hour, including failures and UTC rollover', source => {
  const attemptedAt = '2026-10-20T23:45:00Z', state = { sources: { [source]: { attemptedAt, status: 'failed' } } };
  expect(isDue(source, state, Date.parse(attemptedAt) + 3599999)).toBe(false);
  expect(isDue(source, state, Date.parse(attemptedAt) + 3600000)).toBe(true);
});
it('daily sources respect Taipei cutoff, weekends and one attempt per date', () => {
  const empty = { sources: {} };
  expect(isDue('quotes', empty, Date.parse('2026-10-20T08:59:59Z'))).toBe(false);
  expect(isDue('quotes', empty, Date.parse('2026-10-20T09:17:00Z'))).toBe(true);
  expect(isDue('horoscope', empty, Date.parse('2026-10-20T00:59:59Z'))).toBe(false);
  expect(isDue('horoscope', empty, Date.parse('2026-10-20T01:17:00Z'))).toBe(true);
  expect(isDue('quotes', empty, Date.parse('2026-10-24T09:17:00Z'))).toBe(false);
  expect(isDue('quotes', { sources: { quotes: { attemptedAt: '2026-10-20T09:17:00Z' } } }, Date.parse('2026-10-20T15:59:00Z'))).toBe(false);
});
const item = size => ({ size_in_bytes: size, expired: false, expires_at: '2026-10-27T12:00:00Z' });
it('reserves upload headroom, counts expired bytes and never deletes a checkpoint', () => {
  expect(assertArtifactBudget([item(ARTIFACT_LIMIT - UPLOAD_RESERVE)])).toBe(ARTIFACT_LIMIT - UPLOAD_RESERVE);
  expect(() => assertArtifactBudget([item(ARTIFACT_LIMIT - UPLOAD_RESERVE + 1)])).toThrow('artifact_budget_exceeded');
  expect(() => assertArtifactBudget([{ ...item(ARTIFACT_LIMIT), expired: true }])).toThrow();
});
it.each([null, [{}], [item(-1)], [item(NaN)]])('refuses unmeasurable storage %j', value => {
  expect(() => assertArtifactBudget(value)).toThrow();
});
it('workflow budgets before requests/uploads and only checkpoints after a safe outcome', async () => {
  const workflow = await readFile('.github/workflows/data-update.yml', 'utf8');
  expect(workflow.indexOf('run: node scripts/artifact-budget.mjs')).toBeLessThan(workflow.indexOf('name: Isolated source updates'));
  expect(workflow.indexOf('artifact-budget.mjs --upload')).toBeLessThan(workflow.indexOf('uses: actions/upload-artifact'));
  expect(workflow).toContain("needs.update.result == 'success'");
  expect(workflow).toContain("needs.deploy.result == 'success' || needs.deploy.result == 'skipped'");
  expect(workflow).toContain('retention-days: 7');
  expect(workflow).toContain("if: steps.decision.outputs.changed == 'true' && github.event_name == 'workflow_dispatch'");
  expect(workflow).not.toMatch(/actions: write|push:|deleteArtifact/);
});

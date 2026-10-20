import { it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { assertCheckpointPublish, selectCheckpoint } from '../scripts/lib/checkpoint-policy.mjs';

const env = { CHECKPOINT_ONLY: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', DEFAULT_BRANCH: 'main', GITHUB_REF: 'refs/heads/main',
  INITIALIZE_STATE: 'false', PUBLISH_CURRENT: 'true', PUBLISH_ENABLED: 'true', DEPLOY_TARGET: 'pages', APPROVED_CHECKPOINT_RUN: '123' };
const now = Date.parse('2026-10-20T08:00:00Z');
const artifact = (id, extra = {}) => ({ name: 'dailyinfo-data-state', expired: false, created_at: '2026-10-20T07:00:00Z', expires_at: '2026-10-27T07:00:00Z', workflow_run: { id, head_branch: 'main' }, ...extra });
const run = { path: '.github/workflows/data-update.yml', event: 'workflow_dispatch', head_branch: 'main', status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40) };
it('requires explicit manual main publication authorization', () => { expect(() => assertCheckpointPublish(env)).not.toThrow(); expect(() => assertCheckpointPublish({ CHECKPOINT_ONLY: 'false' })).not.toThrow(); });
it.each([['GITHUB_EVENT_NAME', 'schedule'], ['DEFAULT_BRANCH', 'other'], ['GITHUB_REF', 'refs/heads/other'], ['INITIALIZE_STATE', 'true'],
  ['PUBLISH_CURRENT', 'false'], ['PUBLISH_ENABLED', 'false'], ['DEPLOY_TARGET', ''], ['APPROVED_CHECKPOINT_RUN', 'untrusted']])('fails closed for %s', (key, value) => expect(() => assertCheckpointPublish({ ...env, [key]: value })).toThrow());
it('selects the latest successful approved checkpoint without source requests', async () => {
  const lookup = vi.fn(async () => run);
  const selected = await selectCheckpoint([artifact(122, { created_at: '2026-10-19T07:00:00Z' }), artifact(123)], lookup, { branch: 'main', exact: true, approvedRun: '123', now });
  expect(selected.workflow_run.id).toBe(123); expect(selected.verifiedHeadSha).toBe(run.head_sha); expect(lookup).toHaveBeenCalledExactlyOnceWith(123);
});
it.each([{ expired: true }, { expires_at: '2026-10-19T00:00:00Z' }, { workflow_run: { id: 123, head_branch: 'other' } }])('rejects expired or foreign checkpoint metadata', async extra => {
  const lookup = vi.fn(); expect(await selectCheckpoint([artifact(123, extra)], lookup, { branch: 'main', exact: true, approvedRun: '123', now })).toBeNull(); expect(lookup).not.toHaveBeenCalled();
});
it.each([{ conclusion: 'failure' }, { status: 'in_progress' }, { path: '.github/workflows/pages-manual.yml' }, { head_branch: 'other' }])('rejects unsuccessful or unrelated runs', async extra => {
  expect(await selectCheckpoint([artifact(123)], async () => ({ ...run, ...extra }), { branch: 'main', exact: true, approvedRun: '123', now })).toBeNull();
});
it('refuses an unapproved newer successful checkpoint rather than falling back', async () => {
  await expect(selectCheckpoint([artifact(124), artifact(123, { created_at: '2026-10-19T07:00:00Z' })], async () => run,
    { branch: 'main', exact: true, approvedRun: '123', now })).rejects.toThrow('checkpoint_approval_changed');
});
it('skips the only source updater step for checkpoint mode and verifies the built site', async () => {
  const text = await readFile('.github/workflows/data-update.yml', 'utf8');
  expect(text).toMatch(/name: Isolated source updates\s+if: inputs.source != 'checkpoint'/);
  expect(text).toContain("CHECKPOINT_ONLY: ${{ inputs.source == 'checkpoint' }}");
  expect(text).toContain('npm run build -- --base=/dailyinfo/'); expect(text).toContain('npm run verify -- --dist');
  expect(text).not.toMatch(/^\s+(?:push|pull_request|workflow_run):/m);
});

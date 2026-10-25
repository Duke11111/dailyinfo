import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { SOURCES, updateData } from '../scripts/lib/data-automation.mjs';
import { releaseDecision } from '../scripts/lib/release-policy.mjs';
import { selectCheckpoint } from '../scripts/lib/checkpoint-policy.mjs';
import { exportState, restoreState } from '../scripts/lib/update-state.mjs';
import { CHECKPOINT_NOW, checkpointFixture } from './fixtures/checkpoint.js';

// No production snapshots, network, credentials or GitHub processes in this suite.
const base = resolve('.cache/test-results/auto-publish-prep');
const now = CHECKPOINT_NOW, commit = 'a'.repeat(40);
const workflow = (await readFile('.github/workflows/data-update.yml', 'utf8')).replace(/\r\n/g, '\n');
const permit = { EVENT: 'schedule', AUTO_PUBLISH_ENABLED: 'true', FREE_USAGE_CONFIRMED: 'true', PUBLISH_ENABLED: 'true', DEPLOY_TARGET: 'pages' };
const vars = { DATA_SCHEDULE_MODE: 'continuous', DATA_AUTOMATION_ENABLED: 'true', DATA_SCHEDULE_ENABLED: 'true', DATA_FREE_USAGE_CONFIRMED: 'true', DATA_AUTO_PUBLISH_ENABLED: 'true', DATA_PUBLISH_ENABLED: 'true', DATA_DEPLOY_TARGET: 'pages' };
const github = { event_name: 'schedule', run_attempt: 1, ref: 'refs/heads/main', event: { schedule: '17 0-15 * * *', repository: { default_branch: 'main', visibility: 'public' } } };
let root;
const file = source => join(root, 'public/data', `${source}.json`);
const bytes = () => Promise.all(SOURCES.map(source => readFile(file(source), 'utf8')));
// Evaluate the actual tracked job expressions, not a separately reimplemented gate.
function gate(job, context = {}) {
  const expression = workflow.split(`  ${job}:\n`)[1].match(/^    if: (.+)$/m)[1];
  return Boolean(Function('inputs', 'vars', 'github', 'needs', 'always', 'format', 'fromJSON', `return (${expression});`)(
    context.inputs ?? {}, context.vars ?? vars, context.github ?? github, context.needs ?? {}, () => true,
    (pattern, value) => pattern.replace('{0}', value), JSON.parse));
}
function canDeploy(decision, updateResult = 'success') {
  // GitHub applies success() implicitly to deploy's if, in addition to this expression.
  return updateResult === 'success' && gate('deploy', { needs: { update: { outputs: { publish: String(decision.publish) } } } });
}
async function refresh(sources, change) {
  return updateData({ root, sources, now: () => now, runner: async (source, { directory }) => {
    const data = JSON.parse(await readFile(file(source), 'utf8'));
    change?.(data, source); await writeFile(join(directory, `${source}.json`), JSON.stringify(data));
  } });
}
const decide = (report, env = {}) => releaseDecision({ ...permit, DATA_CHANGED: String(report.changed), ...env });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Network forbidden in local simulation'); }));
  await mkdir(base, { recursive: true }); root = await mkdtemp(join(base, 'case-'));
  await mkdir(join(root, 'public/data'), { recursive: true });
  await mkdir(join(root, '.cache/data-updates'), { recursive: true });
  for (const source of SOURCES) await writeFile(file(source), JSON.stringify(checkpointFixture(source)));
  await writeFile(join(root, '.cache/data-updates/status.json'), JSON.stringify({ version: 1, sources: {} }));
});
afterEach(async () => {
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.useRealTimers();
  if (!resolve(root).startsWith(base + sep)) throw Error('Unsafe test cleanup');
  await rm(root, { recursive: true });
});
it('validated news change reaches an authorized scheduled deployment candidate', async () => {
  const report = await refresh(['news'], data => { data.articles[0].title = 'Synthetic changed headline'; });
  expect(report.results[0]).toMatchObject({ status: 'updated', code: 'ok' });
  expect(gate('update')).toBe(true); expect(canDeploy(decide(report))).toBe(true);
});
it('all unchanged data does not deploy, even with a code change or force build', async () => {
  const report = await refresh(SOURCES);
  expect(report.results.every(item => item.status === 'unchanged')).toBe(true);
  expect(canDeploy(decide(report, { CODE_CHANGED: 'true', FORCE_BUILD: 'true' }))).toBe(false);
});
it('source-delayed quotes publish only when a genuinely newer trading date changes content', async () => {
  const report = await refresh(['quotes'], data => {
    data.tradeDate = '2026-10-19'; data.quotes.forEach(quote => { quote.date = data.tradeDate; });
  });
  expect(report.results[0]).toMatchObject({ status: 'updated', code: 'source_delayed', sourceDate: '2026-10-19' });
  expect(canDeploy(decide(report))).toBe(true);
  const repeated = await refresh(['quotes']);
  expect(repeated.results[0]).toMatchObject({ status: 'unchanged', code: 'source_delayed' });
  expect(canDeploy(decide(repeated))).toBe(false);
});
it('one failed source preserves old bytes while another valid update remains publishable', async () => {
  const previous = await readFile(file('earthquakes'), 'utf8');
  const report = await refresh(['earthquakes', 'news'], (data, source) => {
    if (source === 'earthquakes') throw Error('Synthetic private error');
    data.articles[0].title = 'Synthetic valid update';
  });
  expect(report.failed).toBe(1); expect(await readFile(file('earthquakes'), 'utf8')).toBe(previous);
  expect(report.results[0]).toMatchObject({ status: 'failed', code: 'update_failed' });
  expect(JSON.stringify(report)).not.toContain('Synthetic private error'); expect(canDeploy(decide(report))).toBe(true);
});
it.each(['AUTO_PUBLISH_ENABLED', 'PUBLISH_ENABLED', 'DEPLOY_TARGET', 'FREE_USAGE_CONFIRMED'])('missing or false %s blocks scheduled publication', key => {
  for (const value of ['', 'false']) expect(canDeploy(decide({ changed: true }, { [key]: value }))).toBe(false);
});
it.each(['DATA_SCHEDULE_ENABLED', 'DATA_AUTOMATION_ENABLED', 'DATA_FREE_USAGE_CONFIRMED'])('actual schedule job never starts without %s', key => {
  for (const value of ['', 'false']) expect(gate('update', { vars: { ...vars, [key]: value } })).toBe(false);
});
it('manual authorization stays independent from schedule and automatic-publish authorization', () => {
  expect(gate('update', { github: { ...github, event_name: 'workflow_dispatch' }, vars: { ...vars, DATA_SCHEDULE_ENABLED: 'false', DATA_FREE_USAGE_CONFIRMED: '' } })).toBe(true);
  expect(decide({ changed: true }, { EVENT: 'workflow_dispatch' }).publish).toBe(false);
  expect(decide({ changed: false }, { EVENT: 'workflow_dispatch', FORCE_BUILD: 'true', AUTO_PUBLISH_ENABLED: '', FREE_USAGE_CONFIRMED: '' }).publish).toBe(true);
});
const metadata = () => ({ name: 'dailyinfo-data-state', expired: false, created_at: '2026-10-20T11:00:00Z', expires_at: '2026-10-27T11:00:00Z', workflow_run: { id: 123, head_branch: 'main' } });
const sourceRun = () => ({ path: '.github/workflows/data-update.yml', event: 'schedule', head_branch: 'main', status: 'completed', conclusion: 'success', head_sha: commit });
it.each(['expired', 'workflow', 'commit'])('rejects %s checkpoint before any candidate update', async fault => {
  const item = metadata(), run = sourceRun();
  if (fault === 'expired') item.expires_at = '2026-10-19T00:00:00Z';
  if (fault === 'workflow') run.path = '.github/workflows/pages-manual.yml';
  if (fault === 'commit') delete run.head_sha;
  const before = await bytes();
  const selected = selectCheckpoint([item], async () => run, { branch: 'main', now });
  if (fault === 'commit') await expect(selected).rejects.toThrow('checkpoint_commit_invalid');
  else expect(await selected).toBeNull();
  expect(await bytes()).toEqual(before);
});
it.each(['manifest', 'checksum', 'schema', 'provenance'])('rejects checkpoint %s before restoring any bytes', async fault => {
  const directory = join(root, 'archive'); await exportState(root, directory, commit); const before = await bytes();
  const manifestPath = join(directory, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath));
  if (fault === 'manifest') manifest.version = 99;
  if (fault === 'checksum') manifest.hashes['news.json'] = '0'.repeat(64);
  if (fault === 'schema') {
    const invalid = '{}'; await writeFile(join(directory, 'news.json'), invalid);
    manifest.hashes['news.json'] = createHash('sha256').update(invalid).digest('hex');
  }
  await writeFile(manifestPath, JSON.stringify(manifest));
  await expect(restoreState(root, directory, now, { expectedCommit: fault === 'provenance' ? 'b'.repeat(40) : commit })).rejects.toThrow();
  expect(await bytes()).toEqual(before);
});
it.each(['source-date', 'fetchedAt'])('rejects %s regression without publishing or changing snapshots', async fault => {
  const before = await bytes();
  const report = await refresh(['quotes'], data => {
    if (fault === 'source-date') { data.tradeDate = '2026-10-15'; data.quotes.forEach(quote => { quote.date = data.tradeDate; }); }
    else data.fetchedAt = '2026-10-20T10:00:00Z';
  });
  expect(report.results[0]).toMatchObject({ status: 'failed', code: 'validation_failed' });
  expect(canDeploy(decide(report))).toBe(false); expect(await bytes()).toEqual(before);
});
it('ordinary restore preserves a newer repository snapshot and accepts v2/state v1', async () => {
  const directory = join(root, 'archive'); await exportState(root, directory, commit);
  const newer = checkpointFixture('news'); newer.fetchedAt = '2026-10-20T12:00:00.000Z';
  const text = JSON.stringify(newer); await writeFile(file('news'), text);
  expect((await restoreState(root, directory, now, { expectedCommit: commit })).version).toBe(2);
  expect(await readFile(file('news'), 'utf8')).toBe(text);
  expect(JSON.parse(await readFile(join(root, '.cache/data-updates/status.json'))).version).toBe(1);
});
it.each(['test', 'build', 'public-safety'])('%s failure prevents deploy and persistent checkpoint advancement', stage => {
  expect(canDeploy(decide({ changed: true }), 'failure')).toBe(false);
  expect(gate('checkpoint', { needs: { update: { result: 'failure' }, deploy: { result: 'skipped' } } })).toBe(false);
  const positions = ['npm test', 'npm run build -- --base=/dailyinfo/', 'npm run verify -- --dist', 'name: Prepare validated checkpoint', 'uses: actions/upload-pages-artifact'].map(text => workflow.indexOf(text));
  expect(positions.every(position => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(workflow).not.toMatch(/continue-on-error:/);
});
it('failed/cancelled deployment cannot advance checkpoint; an authorized non-publishing update can', () => {
  for (const result of ['failure', 'cancelled']) expect(gate('checkpoint', { needs: { update: { result: 'success' }, deploy: { result } } })).toBe(false);
  expect(gate('checkpoint', { needs: { update: { result: 'success' }, deploy: { result: 'skipped' } } })).toBe(true);
});

import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { d4Config, d4SwitchesSafe, admitD4, assertD4StartWindow, assertD4Checkpoint, acceptanceReport, snapshotFacts, D4_CRON, D4_FILES } from '../scripts/lib/d4-acceptance.mjs';
import { SOURCES, updateData, runSource } from '../scripts/lib/data-automation.mjs';
import { exportState } from '../scripts/lib/update-state.mjs';
import { checkpointFixture } from './fixtures/checkpoint.js';

const now = Date.parse('2026-10-20T12:43:00Z'), base = resolve('.cache/test-results/d4-once');
const config = () => ({ version: 1, id: 'd4-20261020-evening', expectedSha: 'b'.repeat(40), target: '2026-10-20T20:43:00+08:00', deadline: '2026-10-20T21:30:00+08:00',
  deploymentId: 7, checkpoint: { runId: 100, artifactId: 200, commit: 'a'.repeat(40), digest: 'sha256:' + 'c'.repeat(64) },
  published: Object.fromEntries(D4_FILES.map(name => [name, 'd'.repeat(64)])) });
const env = () => ({ GITHUB_EVENT_NAME: 'schedule', SCHEDULE_CRON: D4_CRON, GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'b'.repeat(40),
  GITHUB_REPOSITORY: 'Duke11111/dailyinfo', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '123', AUTOMATION: 'true', SCHEDULE: 'true', FREE: 'true', PUBLISH: 'false' });
const current = () => ({ id: 123, event: 'schedule', path: '.github/workflows/data-update.yml', head_branch: 'main', head_sha: 'b'.repeat(40), created_at: '2026-10-20T12:43:00Z' });
let root;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Real network prohibited'); }));
  await mkdir(base, { recursive: true }); root = await mkdtemp(join(base, 'case-'));
  await mkdir(join(root, 'public/data'), { recursive: true }); await mkdir(join(root, '.cache/data-updates'), { recursive: true });
  for (const source of SOURCES) await writeFile(join(root, `public/data/${source}.json`), JSON.stringify(checkpointFixture(source)));
});
afterEach(async () => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.useRealTimers(); if (!resolve(root).startsWith(base + sep)) throw Error('Unsafe cleanup'); await rm(root, { recursive: true }); });

it('admits one exact 20:43 schedule, not an acceptance PASS', () => {
  expect(admitD4(d4Config(config()), env(), { runs: [current()], artifacts: [], now })).toMatchObject({ id: config().id, runId: 123 });
});
it.each([
  ['GITHUB_EVENT_NAME', 'workflow_dispatch'], ['SCHEDULE_CRON', '47 14 * * *'], ['GITHUB_REF', 'refs/heads/other'],
  ['GITHUB_SHA', 'c'.repeat(40)], ['GITHUB_RUN_ATTEMPT', '2'], ['AUTOMATION', 'false'], ['SCHEDULE', 'false'],
  ['FREE', ''], ['PUBLISH', 'true'], ['AUTO_PUBLISH', 'true'], ['DEPLOY_TARGET', 'pages'],
])('refuses unsafe %s without a source request', (key, value) => {
  expect(() => admitD4(config(), { ...env(), [key]: value }, { runs: [current()], artifacts: [], now })).toThrow();
});
it.each(['2026-10-20T12:42:59Z', '2026-10-20T13:10:01Z', '2026-10-20T13:30:01Z', '2026-10-21T12:43:00Z'])('refuses early/late/next-day start %s even if Variables stay true', text => {
  expect(() => admitD4(config(), env(), { runs: [current()], artifacts: [], now: Date.parse(text) })).toThrow();
});
it.each(['claim', 'failed-run', 'cancelled-run', 'completed-run', 'queued-run'])('never reuses authorization after %s', mode => {
  const runs = [current()], artifacts = [];
  if (mode === 'claim') artifacts.push({ name: config().id + '-claim', expired: false });
  else runs.push({ ...current(), id: 122, conclusion: mode === 'failed-run' ? 'failure' : mode === 'cancelled-run' ? 'cancelled' : mode === 'completed-run' ? 'success' : null });
  expect(() => admitD4(config(), env(), { runs, artifacts, now })).toThrow();
});
it('a new workflow commit is independent of the approved older checkpoint commit', () => {
  const c = config(); c.checkpoint.commit = '0471d5a64afaea5af87384c1763b566d36cdef64';
  expect(admitD4(c, env(), { runs: [current()], artifacts: [], now }).commit).toBe(c.expectedSha);
  expect(() => assertD4Checkpoint(c, { id: 200, workflow_run: { id: 100 }, verifiedHeadSha: c.checkpoint.commit, digest: c.checkpoint.digest })).not.toThrow();
  expect(() => admitD4({ ...c, expectedSha: c.checkpoint.commit }, env(), { runs: [current()], artifacts: [], now })).toThrow();
});
it('rechecks the start window after slow external admission checks', () => {
  expect(() => assertD4StartWindow(config(), Date.parse('2026-10-20T13:09:59Z'))).not.toThrow();
  expect(() => assertD4StartWindow(config(), Date.parse('2026-10-20T13:10:01Z'))).toThrow();
});
it('an expired/missing claim does not bypass cancellation history or the fixed deadline', () => {
  expect(() => admitD4(config(), env(), { runs: [current()], artifacts: [{ name: config().id + '-claim', expired: true }], now })).toThrow();
  expect(() => admitD4(config(), env(), { runs: [current(), { ...current(), id: 122, conclusion: 'cancelled' }], artifacts: [], now })).toThrow();
  expect(() => admitD4(config(), env(), { runs: [current()], artifacts: [], now: now + 86400000 })).toThrow();
});
it('does not report PASS for a missed schedule, an unknown history or malformed config', () => {
  expect(() => admitD4(config(), env(), { runs: [], artifacts: [], now })).toThrow();
  expect(() => admitD4(config(), env(), { runs: null, artifacts: [], now })).toThrow();
  expect(() => d4Config({ ...config(), deadline: '2026-10-21T21:30:00+08:00' })).toThrow();
  expect(() => d4Config({ ...config(), published: {} })).toThrow();
});
it('requires the exact approved checkpoint metadata, not initialization or another artifact', () => {
  const c = config(), selected = { id: 200, workflow_run: { id: 100 }, verifiedHeadSha: 'a'.repeat(40), digest: c.checkpoint.digest };
  expect(() => assertD4Checkpoint(c, selected)).not.toThrow();
  for (const value of [null, { ...selected, id: 201 }, { ...selected, digest: 'sha256:' + 'e'.repeat(64) }]) expect(() => assertD4Checkpoint(c, value)).toThrow();
});
async function evidence() {
  const state = { version: 1, sources: { horoscope: { attemptedAt: '2026-10-20T02:37:00Z', lastSuccessAt: '2026-10-20T02:37:00Z', status: 'updated', code: 'ok' } } };
  await writeFile(join(root, '.cache/data-updates/status.json'), JSON.stringify(state));
  const before = { state, files: {} };
  for (const source of SOURCES) before.files[source] = snapshotFacts(source, await readFile(join(root, `public/data/${source}.json`), 'utf8'), now);
  const report = await updateData({ root, scheduled: true, cron: D4_CRON, now: () => now, runner: async (source, { directory }) => {
    const data = checkpointFixture(source);
    if (source === 'news') { data.fetchedAt = '2026-10-20T12:43:00.000Z'; data.articles[0].title = 'Synthetic evening news'; }
    await writeFile(join(directory, source + '.json'), JSON.stringify(data));
  } });
  const archive = join(root, 'checkpoint'); await exportState(root, archive, config().expectedSha);
  const manifest = JSON.parse(await readFile(join(archive, 'manifest.json'))), after = {};
  for (const source of SOURCES) after[source] = snapshotFacts(source, await readFile(join(root, `public/data/${source}.json`), 'utf8'), now);
  return { config: config(), env: env(), jobs: { update: 'success', deploy: 'skipped', checkpoint: 'success' }, before, report, after, manifest,
    artifact: { id: 300, expired: false, expires_at: '2026-10-27T12:43:00Z', workflow_run: { id: 123 } }, publicUnchanged: true, now: now + 60000 };
}
it.each([
  ['AUTOMATION', undefined], ['AUTOMATION', 'TRUE'], ['SCHEDULE', undefined], ['SCHEDULE', 'false'],
  ['FREE', undefined], ['FREE', 'true '], ['PUBLISH', undefined], ['PUBLISH', 'true'], ['PUBLISH', false],
  ['AUTO_PUBLISH', 'true'], ['AUTO_PUBLISH', 'false'], ['AUTO_PUBLISH', false], ['AUTO_PUBLISH', null],
  ['DEPLOY_TARGET', 'pages'], ['DEPLOY_TARGET', ' '], ['DEPLOY_TARGET', false], ['DEPLOY_TARGET', null],
])('admission and final acceptance both reject unsafe context %s=%s', async (key, value) => {
  const unsafe = { ...env(), [key]: value };
  expect(d4SwitchesSafe(unsafe)).toBe(false);
  expect(() => admitD4(config(), unsafe, { runs: [current()], artifacts: [], now })).toThrow();
  const input = await evidence(); input.env = unsafe;
  const result = acceptanceReport(input);
  expect(result.checks.safetySwitches).toBe(false); expect(result.pass).toBe(false);
});
it('accepts absent optional values represented by GitHub as empty strings', () => {
  expect(d4SwitchesSafe({ ...env(), AUTO_PUBLISH: '', DEPLOY_TARGET: '' })).toBe(true);
});
it('independently accepts updated news, delayed quotes, unchanged earthquakes and legitimately skipped horoscope', async () => {
  const input = await evidence(), result = acceptanceReport(input);
  expect(input.report.results.map(({ status, code }) => [status, code])).toEqual([
    ['unchanged', 'source_delayed'], ['updated', 'ok'], ['unchanged', 'ok'], ['skipped', 'not_due'],
  ]);
  expect(result.pass).toBe(true); expect(result.summary).toContain('D4 acceptance: PASS');
  expect(result.summary).toContain('Time expiry does NOT turn off Repository Variables');
});
it.each(['failed-source', 'wrong-skip', 'old-date', 'checksum', 'expired', 'deployed', 'update-failed', 'checkpoint-failed', 'public-changed', 'late-report', 'manual'])('reports FAIL for %s even if the workflow looks green', async fault => {
  const input = await evidence();
  if (fault === 'failed-source') { input.report.results[0].status = 'failed'; input.report.results[0].code = 'update_failed'; input.report.failed = 1; }
  if (fault === 'wrong-skip') { input.report.results[1].status = 'skipped'; input.report.results[1].code = 'not_due'; }
  if (fault === 'old-date') input.after.quotes.sourceDate = '2026-10-15';
  if (fault === 'checksum') input.manifest.hashes['quotes.json'] = '0'.repeat(64);
  if (fault === 'expired') input.artifact.expired = true;
  if (fault === 'deployed') input.jobs.deploy = 'success';
  if (fault === 'update-failed') input.jobs.update = 'failure';
  if (fault === 'checkpoint-failed') input.jobs.checkpoint = 'failure';
  if (fault === 'public-changed') input.publicUnchanged = false;
  if (fault === 'late-report') input.now = Date.parse('2026-10-20T13:30:01Z');
  if (fault === 'manual') input.env.GITHUB_EVENT_NAME = 'workflow_dispatch';
  expect(acceptanceReport(input).pass).toBe(false);
});
it('does not start a new source when the deadline is reached, and preserves existing bytes', async () => {
  const before = await readFile(join(root, 'public/data/news.json'), 'utf8'), runner = vi.fn();
  await expect(updateData({ root, sources: ['news'], now: () => now, deadline: now, runner })).rejects.toThrow('acceptance_expired');
  expect(runner).not.toHaveBeenCalled(); expect(await readFile(join(root, 'public/data/news.json'), 'utf8')).toBe(before);
});
it('passes a finite deadline to the child and cannot start a second source after it expires', async () => {
  let clock = now;
  const runner = vi.fn(async (source, settings) => { expect(settings.deadline).toBe(now + 1000); clock += 1000; throw Error('Synthetic timeout'); });
  await expect(updateData({ root, sources: ['news', 'earthquakes'], now: () => clock, deadline: now + 1000, runner })).rejects.toThrow('acceptance_expired');
  expect(runner).toHaveBeenCalledTimes(1);
});
it('cannot accept a candidate returned after the deadline or overwrite the previous snapshot', async () => {
  let clock = now; const file = join(root, 'public/data/news.json'), old = await readFile(file, 'utf8');
  await expect(updateData({ root, sources: ['news'], now: () => clock, deadline: now + 1000, runner: async (source, { directory }) => {
    const data = checkpointFixture(source); data.articles[0].title = 'Synthetic late news';
    await writeFile(join(directory, source + '.json'), JSON.stringify(data)); clock += 1000;
  } })).rejects.toThrow('acceptance_expired');
  expect(await readFile(file, 'utf8')).toBe(old);
});
it('cannot start the batch after 21:10 even though the final deadline is 21:30', async () => {
  const runner = vi.fn();
  await expect(updateData({ root, sources: ['news'], now: () => now + 2000, startBy: now + 1000, deadline: now + 3600000, runner })).rejects.toThrow('acceptance_expired');
  expect(runner).not.toHaveBeenCalled();
});
it('cannot start its first source if asynchronous setup crosses the latest start time', async () => {
  let clock = now; const runner = vi.fn(), file = join(root, 'public/data/news.json'), before = await readFile(file, 'utf8');
  const pending = updateData({ root, sources: ['news'], now: () => clock, startBy: now + 1000, deadline: now + 3600000, runner });
  clock += 2000;
  await expect(pending).rejects.toThrow('acceptance_expired');
  expect(runner).not.toHaveBeenCalled(); expect(await readFile(file, 'utf8')).toBe(before);
});
it('bounds an actual local child process by remaining time without any network', async () => {
  vi.useRealTimers();
  await mkdir(join(root, 'scripts'));
  await writeFile(join(root, 'scripts/update-quotes.mjs'), 'setTimeout(() => {}, 5000);');
  await expect(runSource('quotes', { root, directory: root, deadline: Date.now() + 200 })).rejects.toMatchObject({ safeCode: 'update_failed' });
});
it('CLI errors cannot leak raw config/errors and do not invoke GitHub when config is invalid', async () => {
  const summary = join(root, 'summary.md');
  try {
    execFileSync(process.execPath, [resolve('scripts/d4-acceptance.mjs'), 'admit'], { cwd: root, env: { ...process.env, D4_CONFIG: 'private-test-content', GITHUB_STEP_SUMMARY: summary }, stdio: ['ignore', 'pipe', 'pipe'] });
    throw Error('Expected rejection');
  } catch (error) { expect(error.status).toBe(1); expect(String(error.stderr)).not.toContain('private-test-content'); }
  expect(await readFile(summary, 'utf8')).toContain('D4 acceptance: FAIL');
});
it('workflow keeps manual behavior, persists a claim before requests, and cannot deploy the schedule', async () => {
  const workflow = (await readFile('.github/workflows/data-update.yml', 'utf8')).replace(/\r\n/g, '\n');
  const condition = workflow.split('  update:\n')[1].match(/^    if: (.+)$/m)[1];
  const gate = (event, vars, cron = D4_CRON, visibility = 'public') => Function('inputs', 'vars', 'github', 'format', 'fromJSON', `return (${condition});`)({}, vars,
    { ref: 'refs/heads/main', event_name: event, run_attempt: 1, event: { schedule: cron, repository: { default_branch: 'main', visibility } } }, (pattern, value) => pattern.replace('{0}', value), JSON.parse);
  const vars = { DATA_SCHEDULE_MODE: 'd4', DATA_AUTOMATION_ENABLED: 'true', DATA_SCHEDULE_ENABLED: 'true', DATA_FREE_USAGE_CONFIRMED: 'true', DATA_D4_ONCE: '{}' };
  expect(gate('schedule', vars)).toBe(true);
  expect(gate('schedule', vars, D4_CRON, 'private')).toBe(false);
  expect(gate('schedule', vars, D4_CRON, '')).toBe(false);
  expect(gate('schedule', { ...vars, DATA_D4_ONCE: '' })).toBe(false);
  expect(gate('schedule', { ...vars, DATA_SCHEDULE_ENABLED: 'false' })).toBe(false);
  expect(gate('schedule', vars, '47 14 * * *')).toBe(false);
  expect(gate('schedule', vars, '37 2 * * *')).toBe(false);
  expect(gate('workflow_dispatch', { DATA_AUTOMATION_ENABLED: 'true' })).toBe(true);
  expect(workflow.indexOf('name: Persist single-use claim')).toBeLessThan(workflow.indexOf('name: Isolated source updates'));
  expect(workflow).toContain("github.event_name != 'schedule' && inputs.external_schedule != true) || (vars.DATA_SCHEDULE_MODE == 'continuous'");
  expect(workflow).toContain("vars.DATA_SCHEDULE_MODE == 'continuous' && vars.DATA_AUTO_PUBLISH_ENABLED || 'false'");
  expect(workflow).toContain('needs: [update, deploy, checkpoint]');
  expect(workflow).not.toMatch(/actions: write|gh variable|initialize_state: true/);
  const cli = await readFile('scripts/d4-acceptance.mjs', 'utf8');
  expect(cli).not.toContain('actions/variables');
  expect(cli).toContain('d4SwitchesSafe(process.env)');
  for (const [key, variable] of Object.entries({ AUTOMATION: 'DATA_AUTOMATION_ENABLED', SCHEDULE: 'DATA_SCHEDULE_ENABLED', FREE: 'DATA_FREE_USAGE_CONFIRMED', PUBLISH: 'DATA_PUBLISH_ENABLED', AUTO_PUBLISH: 'DATA_AUTO_PUBLISH_ENABLED', DEPLOY_TARGET: 'DATA_DEPLOY_TARGET' })) {
    expect(workflow).toContain(key + ': ${{ vars.' + variable + ' }}');
  }
});

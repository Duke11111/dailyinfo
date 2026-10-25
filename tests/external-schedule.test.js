import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertExternalScheduleInputs } from '../scripts/lib/external-schedule.mjs';
import { scheduledMode } from '../scripts/lib/schedule-mode.mjs';
import { HOURLY_CRON, scheduleDecision } from '../scripts/lib/source-schedule.mjs';
import { releaseDecision } from '../scripts/lib/release-policy.mjs';
import { updateData, SOURCES } from '../scripts/lib/data-automation.mjs';
import { exportState, restoreState } from '../scripts/lib/update-state.mjs';
import { checkpointFixture } from './fixtures/checkpoint.js';
import { isoInstant } from '../src/lib/time.js';
import worker, { dispatchTick, CRON } from '../external-scheduler/cloudflare-worker/worker.mjs';

const env = () => ({ GITHUB_EVENT_NAME: 'workflow_dispatch', EVENT: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'Duke11111/dailyinfo', GITHUB_RUN_ATTEMPT: '1',
  EXTERNAL_SCHEDULE: 'true', SOURCE: 'core', INITIALIZE_STATE: 'false', INITIALIZE_MANIFEST: 'false',
  CHECKPOINT_ONLY: 'false', PUBLISH_CURRENT: 'false', BASELINE_APPROVAL: '', APPROVED_CHECKPOINT_RUN: '',
  AUTOMATION: 'true', SCHEDULE: 'true', FREE: 'true', SCHEDULE_MODE: 'continuous', SCHEDULE_CRON: HOURLY_CRON,
  AUTO_PUBLISH_ENABLED: 'true', FREE_USAGE_CONFIRMED: 'true', PUBLISH_ENABLED: 'true', DEPLOY_TARGET: 'pages',
});
const workflow = (await readFile('.github/workflows/data-update.yml', 'utf8')).replace(/\r\n/g, '\n');
const inputs = () => ({ external_schedule: true, source: 'core', initialize_state: false, initialize_manifest: false,
  publish_current: false, checkpoint_run: '', baseline_approval: '' });
const vars = () => ({ DATA_AUTOMATION_ENABLED: 'true', DATA_SCHEDULE_ENABLED: 'true', DATA_SCHEDULE_MODE: 'continuous',
  DATA_FREE_USAGE_CONFIRMED: 'true', DATA_AUTO_PUBLISH_ENABLED: 'true', DATA_PUBLISH_ENABLED: 'true', DATA_DEPLOY_TARGET: 'pages' });
const github = () => ({ event_name: 'workflow_dispatch', ref: 'refs/heads/main', run_attempt: 1,
  event: { repository: { visibility: 'public', default_branch: 'main' } } });
function gate(job, i = inputs(), v = vars(), g = github(), publish = 'true') {
  const expression = workflow.split(`  ${job}:\n`)[1].match(/^    if: (.+)$/m)[1];
  return Boolean(Function('inputs', 'vars', 'github', 'needs', 'format', 'fromJSON', `return (${expression});`)(
    i, v, g, { update: { outputs: { publish } } }, (p, s) => p.replace('{0}', s), JSON.parse));
}
it('external dispatch has both YAML and Node scheduled admission; ordinary manual mode stays independent', () => {
  expect(gate('update')).toBe(true); expect(scheduledMode(env())).toBe('continuous');
  expect(assertExternalScheduleInputs({ ...env(), EXTERNAL_SCHEDULE: 'false' })).toBe(false);
  expect(gate('update', { external_schedule: false, source: 'quotes' }, { DATA_AUTOMATION_ENABLED: 'true' })).toBe(true);
  expect(releaseDecision({ EVENT: 'workflow_dispatch', FORCE_BUILD: 'true', PUBLISH_ENABLED: 'true', DEPLOY_TARGET: 'pages' }).publish).toBe(true);
  expect(workflow).toContain('external_schedule:\n        description: Hourly automation tick');
  expect(workflow).toContain('EXTERNAL_SCHEDULE: ${{ inputs.external_schedule }}');
  // A step-local native-event-only override would erase the external canonical cron.
  expect(workflow.match(/^\s+SCHEDULE_CRON:/gm)).toHaveLength(1);
  expect(workflow).toContain("SCHEDULE_CRON: ${{ inputs.external_schedule == true && '17 0-15 * * *' || github.event.schedule }}");
  expect(workflow).toContain('if [ "$EXTERNAL_SCHEDULE" = "true" ]; then\n            npm run update:data -- --sources=core --scheduled');
});
it.each([
  ['initialize_state', 'INITIALIZE_STATE', true, 'true'],
  ['initialize_manifest', 'INITIALIZE_MANIFEST', true, 'true'],
  ['publish_current', 'PUBLISH_CURRENT', true, 'true'],
  ['checkpoint_run', 'APPROVED_CHECKPOINT_RUN', '123', '123'],
  ['baseline_approval', 'BASELINE_APPROVAL', 'sha256:unapproved', 'sha256:unapproved'],
  ['source', 'SOURCE', 'checkpoint', 'checkpoint'], ['source', 'SOURCE', 'quotes', 'quotes'],
])('rejects external management input %s before source requests or checkpoint recovery', (input, key, value, text) => {
  expect(gate('update', { ...inputs(), [input]: value })).toBe(false);
  expect(() => scheduledMode({ ...env(), [key]: text })).toThrow('external_schedule_invalid');
  expect(() => releaseDecision({ ...env(), [key]: text, DATA_CHANGED: 'true' })).toThrow();
});
it.each(['true', 'TRUE', '1', 'invalid'])('rejects malformed external flags/booleans: %s', bad => {
  if (bad !== 'true') expect(() => assertExternalScheduleInputs({ ...env(), EXTERNAL_SCHEDULE: bad })).toThrow();
  expect(() => assertExternalScheduleInputs({ ...env(), INITIALIZE_STATE: bad })).toThrow();
});
it.each(['DATA_SCHEDULE_ENABLED', 'DATA_FREE_USAGE_CONFIRMED', 'DATA_SCHEDULE_MODE'])('external update requires %s', key => {
  for (const value of ['', 'false']) expect(gate('update', inputs(), { ...vars(), [key]: value })).toBe(false);
});
it.each(['AUTOMATION', 'SCHEDULE', 'FREE', 'GITHUB_REF', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ATTEMPT', 'SCHEDULE_MODE', 'SCHEDULE_CRON'])('external Node gate independently rejects missing %s', key => {
  expect(() => scheduledMode({ ...env(), [key]: '' })).toThrow();
});
it('blocks reruns, feature branches, private repositories and the historical D4 mode', () => {
  expect(gate('update', inputs(), vars(), { ...github(), run_attempt: 2 })).toBe(false);
  expect(gate('update', inputs(), vars(), { ...github(), ref: 'refs/heads/feature' })).toBe(false);
  expect(gate('update', inputs(), vars(), { ...github(), event: { repository: { visibility: 'private', default_branch: 'main' } } })).toBe(false);
  expect(gate('update', inputs(), { ...vars(), DATA_SCHEDULE_MODE: 'd4' })).toBe(false);
  expect(() => scheduledMode({ ...env(), SCHEDULE_MODE: 'd4' })).toThrow();
});
it.each(['DATA_AUTO_PUBLISH_ENABLED', 'DATA_PUBLISH_ENABLED', 'DATA_DEPLOY_TARGET', 'DATA_FREE_USAGE_CONFIRMED', 'DATA_SCHEDULE_ENABLED', 'DATA_SCHEDULE_MODE'])('external deploy independently requires %s', key => {
  expect(gate('deploy')).toBe(true);
  expect(gate('deploy', inputs(), { ...vars(), [key]: '' })).toBe(false);
});
it('external dispatch cannot build/deploy unchanged data, even when code changed; valid fresh data uses automatic authorization', () => {
  expect(releaseDecision({ ...env(), DATA_CHANGED: 'false', CODE_CHANGED: 'true', FORCE_BUILD: 'true' })).toEqual({ changed: false, publish: false });
  expect(releaseDecision({ ...env(), DATA_CHANGED: 'true' })).toEqual({ changed: true, publish: true });
  expect(releaseDecision({ ...env(), DATA_CHANGED: 'true', AUTO_PUBLISH_ENABLED: '' }).publish).toBe(false);
  expect(gate('deploy', inputs(), vars(), github(), 'false')).toBe(false);
});
it('uses actual Taipei date/hour, including delayed external dispatch and UTC rollover, with weekday close checks', () => {
  const decide = (source, instant) => scheduleDecision(source, { sources: {} }, Date.parse(instant), { cron: HOURLY_CRON });
  expect(decide('news', '2026-10-20T00:17:00Z').due).toBe(true);
  expect(decide('quotes', '2026-10-20T08:59:00Z').reason).toBe('before_market_close');
  expect(decide('quotes', '2026-10-20T12:40:00Z').due).toBe(true);
  expect(decide('news', '2026-10-20T16:01:00Z').reason).toBe('before_window');
  expect(decide('horoscope', '2026-10-20T00:17:00Z').due).toBe(false);
  expect(decide('quotes', '2026-10-25T10:17:00Z').reason).toBe('weekend');
});
it('validates external admission before GitHub restore; no CLI entry can accidentally bypass due checks', async () => {
  const restore = await readFile('scripts/automation-state.mjs', 'utf8');
  expect(restore.indexOf('externalScheduleRequested(process.env) ? scheduledMode(process.env)')).toBeLessThan(restore.indexOf("await gh(['api'"));
  const updater = await readFile('scripts/update-data.mjs', 'utf8');
  expect(updater).toContain("args.includes('--scheduled') || externalScheduleRequested(process.env)");
  expect(updater).toContain("selected !== '--sources=core'");
  expect(workflow.indexOf('name: Validate external tick')).toBeLessThan(workflow.indexOf('name: Check free storage'));
  // Invalid configuration exits safely before any gh/source process can be reached.
  for (const script of ['authorize-external-schedule.mjs', 'automation-state.mjs', 'update-data.mjs']) {
    expect(() => execFileSync(process.execPath, ['scripts/' + script, ...(script === 'automation-state.mjs' ? ['restore'] : [])],
      { env: { ...process.env, ...env(), SOURCE: 'checkpoint' }, stdio: 'pipe', timeout: 10000, windowsHide: true })).toThrow();
  }
});

const base = resolve('.cache/test-results/external-schedule'); let root, clock;
beforeEach(async () => {
  clock = Date.parse('2026-10-20T18:17:00+08:00');
  await mkdir(base, { recursive: true }); root = await mkdtemp(join(base, 'case-'));
  await mkdir(join(root, 'public/data'), { recursive: true });
  for (const source of SOURCES) {
    const data = checkpointFixture(source); data.fetchedAt = '2026-10-19T16:00:00.000Z';
    if (source === 'horoscope') data.readings.forEach(r => { r.date = '2026-10-19'; });
    await writeFile(join(root, 'public/data', source + '.json'), JSON.stringify(data));
  }
});
afterEach(async () => { if (!resolve(root).startsWith(base + sep)) throw Error('unsafe_cleanup'); await rm(root, { recursive: true }); });
it.each(['external-first', 'native-first'])('both triggers share persisted same-hour dedupe (%s), preserving bytes and fetchedAt on no change', async order => {
  const before = await Promise.all(SOURCES.map(s => readFile(join(root, 'public/data', s + '.json'), 'utf8')));
  const runner = vi.fn(async (source, { directory }) => {
    const path = join(directory, source + '.json'), data = JSON.parse(await readFile(path));
    data.fetchedAt = isoInstant(clock); await writeFile(path, JSON.stringify(data));
  });
  const native = { ...env(), EXTERNAL_SCHEDULE: 'false', GITHUB_EVENT_NAME: 'schedule' };
  const first = order === 'external-first' ? env() : native;
  const second = order === 'external-first' ? native : env();
  expect(scheduledMode(first)).toBe('continuous');
  const refresh = () => updateData({ root, sources: SOURCES, scheduled: true, cron: HOURLY_CRON, now: () => clock, runner });
  const report = await refresh(); expect(report.changed).toBe(false);
  expect(releaseDecision({ ...env(), DATA_CHANGED: String(report.changed), CODE_CHANGED: 'true' }).changed).toBe(false);
  const archive = join(root, 'checkpoint'); await exportState(root, archive, 'a'.repeat(40));
  await restoreState(root, archive, clock, { exact: true, expectedCommit: 'a'.repeat(40) });
  clock += 10 * 60000; expect(scheduledMode(second)).toBe('continuous');
  expect((await refresh()).results.every(r => r.status === 'skipped')).toBe(true);
  expect(runner).toHaveBeenCalledTimes(4);
  expect(await Promise.all(SOURCES.map(s => readFile(join(root, 'public/data', s + '.json'), 'utf8')))).toEqual(before);
});
it.each(SOURCES)('external hourly %s cannot replace a newer validated source date with an old API result', async source => {
  const path = join(root, 'public/data', source + '.json'), before = await readFile(path, 'utf8');
  const runner = async (_, { directory }) => {
    const data = JSON.parse(before); data.fetchedAt = isoInstant(clock);
    if (source === 'quotes') { data.tradeDate = '2026-10-15'; data.quotes.forEach(q => { q.date = data.tradeDate; }); }
    if (source === 'news') data.articles.forEach(a => { a.publishedAt = '2026-10-01T00:00:00.000Z'; });
    if (source === 'earthquakes') data.events.forEach(e => { e.originTime = '2026-10-01T00:00:00.000Z'; });
    if (source === 'horoscope') data.readings.forEach(r => { r.date = '2026-10-18'; });
    await writeFile(join(directory, source + '.json'), JSON.stringify(data));
  };
  const report = await updateData({ root, sources: [source], scheduled: true, cron: HOURLY_CRON, now: () => clock, runner });
  expect(report.changed).toBe(false); expect(report.results[0].code).toBe('validation_failed');
  expect(await readFile(path, 'utf8')).toBe(before);
});

const workerEnv = () => ({ ENABLED: 'true', FREE_USAGE_CONFIRMED: 'true', GITHUB_TOKEN: 'synthetic-test-only' });
const event = () => ({ cron: CRON, scheduledTime: Date.parse('2026-10-20T00:17:00Z') });
const transport = () => ({ now: () => event().scheduledTime + 1000, fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 204 })) });
it('Worker posts once to the fixed GitHub endpoint with safe inputs, an encrypted binding, no redirect or source access', async () => {
  const io = transport(); expect(await dispatchTick(event(), workerEnv(), io)).toEqual({ code: 'dispatch_accepted' });
  expect(io.fetchImpl).toHaveBeenCalledTimes(1);
  const [url, request] = io.fetchImpl.mock.calls[0];
  expect(url).toBe('https://api.github.com/repos/Duke11111/dailyinfo/actions/workflows/data-update.yml/dispatches');
  expect(request).toMatchObject({ method: 'POST', redirect: 'manual', headers: { Authorization: 'Bearer synthetic-test-only' } });
  expect(JSON.parse(request.body)).toEqual({ ref: 'main', inputs: inputs() });
  expect(request.signal).toBeInstanceOf(AbortSignal);
  expect((await worker.fetch(new Request('https://example.invalid/trigger'))).status).toBe(404);
});
it.each([200, 204, 300, 301, 302, 303, 304, 305, 307, 308, 399, 401, 403, 422, 429, 500])('Worker handles HTTP %i without body disclosure or retries', async status => {
  const io = transport(); io.fetchImpl.mockResolvedValue(new Response([204, 304].includes(status) ? null : 'private response text', { status }));
  const result = await dispatchTick(event(), workerEnv(), io);
  expect(result.code).toBe([200, 204].includes(status) ? 'dispatch_accepted' : 'dispatch_rejected');
  expect(JSON.stringify(result)).not.toContain('private'); expect(io.fetchImpl).toHaveBeenCalledTimes(1);
});
it('Worker treats ambiguous POST/network errors as unconfirmed and never retries', async () => {
  const io = transport(); io.fetchImpl.mockRejectedValue(Error('private server text'));
  expect(await dispatchTick(event(), workerEnv(), io)).toEqual({ code: 'dispatch_unconfirmed' }); expect(io.fetchImpl).toHaveBeenCalledTimes(1);
});
it('works with a Cloudflare-compatible transport that rejects redirect=error, without following redirects', async () => {
  const io = transport();
  io.fetchImpl.mockImplementation(async (_, request) => {
    // Model the runtime restriction; Node's native fetch alone would accept error mode.
    if (!['manual', 'follow'].includes(request.redirect)) throw TypeError('Unsupported redirect mode');
    expect(request.redirect).toBe('manual');
    return new Response('private redirect response', { status: 302, headers: { Location: 'https://example.invalid/private' } });
  });
  expect(await dispatchTick(event(), workerEnv(), io)).toEqual({ code: 'dispatch_rejected' });
  expect(io.fetchImpl).toHaveBeenCalledTimes(1);
});
it.each([200, 401])('a body cleanup exception preserves the already known HTTP %i result', async status => {
  const io = transport();
  const cancel = vi.fn().mockRejectedValue(Error('private cleanup details'));
  io.fetchImpl.mockResolvedValue({ status, body: { cancel } });
  expect(await dispatchTick(event(), workerEnv(), io)).toEqual({ code: status === 200 ? 'dispatch_accepted' : 'dispatch_rejected' });
  expect(cancel).toHaveBeenCalledTimes(1); expect(io.fetchImpl).toHaveBeenCalledTimes(1);
});
it('scheduled handler logs only the fixed outcome without token, HTTP body, headers or raw exceptions', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private body', { status: 403, headers: { 'X-Private': 'private header' } })));
  vi.spyOn(Date, 'now').mockReturnValue(event().scheduledTime + 1000);
  try {
    await worker.scheduled(event(), workerEnv());
    expect(log.mock.calls).toEqual([['dispatch_rejected']]);
    const output = JSON.stringify(log.mock.calls);
    for (const text of ['synthetic-test-only', 'Authorization', 'private body', 'private header']) expect(output).not.toContain(text);
    globalThis.fetch.mockRejectedValue(Error('private exception'));
    await worker.scheduled(event(), workerEnv());
    expect(log.mock.calls).toEqual([['dispatch_rejected'], ['dispatch_unconfirmed']]);
  } finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
it('Worker aborts a hanging request after eight seconds without a second POST', async () => {
  vi.useFakeTimers();
  try {
    const io = transport(); io.fetchImpl.mockImplementation((_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('private timeout')))));
    const pending = dispatchTick(event(), workerEnv(), io); await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toEqual({ code: 'dispatch_unconfirmed' }); expect(io.fetchImpl).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});
it.each(['ENABLED', 'FREE_USAGE_CONFIRMED', 'GITHUB_TOKEN'])('Worker without %s never sends anything', async key => {
  const io = transport(); await dispatchTick(event(), { ...workerEnv(), [key]: '' }, io); expect(io.fetchImpl).not.toHaveBeenCalled();
});
it.each(['wrong-cron', 'stale', 'future', 'night', 'bad-minute'])('Worker rejects %s deliveries before dispatch', async fault => {
  const e = event(), io = transport();
  if (fault === 'wrong-cron') e.cron = '* * * * *';
  if (fault === 'stale') io.now = () => e.scheduledTime + 16 * 60000;
  if (fault === 'future') io.now = () => e.scheduledTime - 1;
  if (fault === 'night') { e.scheduledTime = Date.parse('2026-10-20T16:17:00Z'); io.now = () => e.scheduledTime; }
  if (fault === 'bad-minute') e.scheduledTime -= 60000;
  expect(await dispatchTick(e, workerEnv(), io)).toEqual({ code: 'invalid_tick' }); expect(io.fetchImpl).not.toHaveBeenCalled();
});
it('keeps native fallback, shared production lock, existing security gates, and a disabled free-only Worker example', async () => {
  expect([...workflow.matchAll(/- cron: '([^']+)'/g)].map(m => m[1])).toEqual([HOURLY_CRON]);
  expect(workflow).toContain('group: dailyinfo-production'); expect(workflow).toContain('cancel-in-progress: false');
  expect(workflow).toContain('node scripts/publish-guard.mjs'); expect(workflow).toContain('node scripts/artifact-budget.mjs');
  expect(workflow).toContain("needs.deploy.result == 'success' || needs.deploy.result == 'skipped'");
  const toml = await readFile('external-scheduler/cloudflare-worker/wrangler.toml', 'utf8');
  expect(toml).toContain('crons = ["17 0-15 * * *"]'); expect(toml).toContain('ENABLED = "false"');
  expect(toml).toContain('FREE_USAGE_CONFIRMED = "false"'); expect(toml).toContain('workers_dev = false');
});

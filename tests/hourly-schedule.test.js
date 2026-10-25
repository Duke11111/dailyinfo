import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { HOURLY_CRON, HOURLY_HOURS, scheduleDecision } from '../scripts/lib/source-schedule.mjs';
import { scheduledMode } from '../scripts/lib/schedule-mode.mjs';
import { updateData, validateState, SOURCES } from '../scripts/lib/data-automation.mjs';
import { releaseDecision, assertArtifactBudget } from '../scripts/lib/release-policy.mjs';
import { exportState, restoreState } from '../scripts/lib/update-state.mjs';
import { checkpointFixture } from './fixtures/checkpoint.js';
import { isoInstant } from '../src/lib/time.js';
const time = local => Date.parse(`2026-10-20T${local}:00+08:00`);
const empty = () => ({ version: 1, sources: {} });
const decide = (source, now, state = empty()) => scheduleDecision(source, state, now, { cron: HOURLY_CRON });
const env = () => ({ GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'Duke11111/dailyinfo', GITHUB_RUN_ATTEMPT: '1', AUTOMATION: 'true', SCHEDULE: 'true', FREE: 'true', SCHEDULE_MODE: 'continuous', SCHEDULE_CRON: HOURLY_CRON });
const permitted = { EVENT: 'schedule', AUTO_PUBLISH_ENABLED: 'true', FREE_USAGE_CONFIRMED: 'true', PUBLISH_ENABLED: 'true', DEPLOY_TARGET: 'pages' };
it.each(HOURLY_HOURS)('accepts Taipei %i:17 and maps it to the UTC cron range', hour => {
  const minute = time(String(hour).padStart(2, '0') + ':17');
  expect(HOURLY_CRON).toBe('17 0-15 * * *'); expect(hour - 8).toBeGreaterThanOrEqual(0); expect(hour - 8).toBeLessThanOrEqual(15);
  expect(scheduledMode(env())).toBe('continuous'); expect(decide('news', minute).due).toBe(true);
  expect(decide('earthquakes', minute).due).toBe(true);
});
it('uses actual Taipei time when cron is delayed hours, without replaying the nominal slot', () => {
  expect(decide('news', time('13:40')).due).toBe(true);
  expect(decide('horoscope', time('13:40')).due).toBe(true);
  expect(decide('quotes', time('16:59')).reason).toBe('before_market_close');
  expect(decide('quotes', time('21:40')).due).toBe(true);
  expect(decide('news', Date.parse('2026-10-20T16:01:00Z')).reason).toBe('before_window'); // Taiwan next day 00:01.
  expect(decide('news', Date.parse('2026-10-19T23:59:00Z')).due).toBe(false); // Taiwan 07:59.
  expect(decide('news', Date.parse('2026-10-20T00:17:00Z')).due).toBe(true); // Taiwan 08:17.
});
it('coalesces several delayed runs in the same actual hour and retains a bounded cooldown', () => {
  const state = { sources: { news: { attemptedAt: isoInstant(time('18:09')), attemptedSlot: 'hourly', status: 'failed', code: 'update_failed' } } };
  expect(decide('news', time('18:55'), state).reason).toBe('window_already_attempted');
  expect(decide('news', time('19:17'), state).due).toBe(true);
  state.sources.news.attemptedAt = isoInstant(time('18:40'));
  expect(decide('news', time('19:17'), state)).toMatchObject({ due: false, reason: 'cooldown' });
  expect(Date.parse(decide('news', time('19:17'), state).nextEligibleAt)).toBeGreaterThan(time('19:17'));
});
it.each(['quotes', 'horoscope'])('does not repeat successful daily %s, but retries a failed/delayed source', source => {
  const at = source === 'quotes' ? '17:17' : '09:17', later = source === 'quotes' ? '18:17' : '10:17';
  const state = { sources: { [source]: { attemptedAt: isoInstant(time(at)), lastSuccessAt: isoInstant(time(at)), status: 'updated', code: 'ok' } } };
  expect(decide(source, time(later), state).reason).toBe('already_successful');
  delete state.sources[source].lastSuccessAt; state.sources[source].status = 'failed'; state.sources[source].code = 'update_failed';
  expect(decide(source, time(later), state).due).toBe(true);
  state.sources[source].status = 'unchanged'; state.sources[source].code = 'source_delayed';
  expect(decide(source, time(later), state).due).toBe(true);
});
it('respects the weekday close and 09:00 horoscope windows; holidays never become invented trade dates', () => {
  expect(decide('horoscope', time('08:59')).due).toBe(false);
  expect(decide('horoscope', time('09:17')).due).toBe(true);
  for (const date of ['2026-10-24', '2026-10-25']) expect(decide('quotes', Date.parse(date + 'T18:17:00+08:00')).reason).toBe('weekend');
  expect(decide('quotes', time('17:17')).due).toBe(true);
});
const base = resolve('.cache/test-results/hourly'); let root, clock;
beforeEach(async () => {
  await mkdir(base, { recursive: true }); root = await mkdtemp(join(base, 'case-')); clock = time('08:17');
  await mkdir(join(root, 'public/data'), { recursive: true });
  for (const source of SOURCES) {
    const data = checkpointFixture(source); data.fetchedAt = '2026-10-19T16:00:00.000Z';
    if (source === 'horoscope') data.readings.forEach(reading => { reading.date = '2026-10-19'; });
    await writeFile(join(root, 'public/data', source + '.json'), JSON.stringify(data));
  }
});
afterEach(async () => { if (!resolve(root).startsWith(base + sep)) throw Error('unsafe_cleanup'); await rm(root, { recursive: true }); });
const run = (runner, sources = ['news', 'earthquakes']) => updateData({ root, sources, scheduled: true, cron: HOURLY_CRON, now: () => clock, runner });
const unchanged = async (source, { directory }) => {
  const data = JSON.parse(await readFile(join(directory, source + '.json'), 'utf8')); data.fetchedAt = isoInstant(clock);
  await writeFile(join(directory, source + '.json'), JSON.stringify(data));
};
it('several hourly no-change checks never build/deploy, even with a code change or force flag', async () => {
  const runner = vi.fn(unchanged);
  for (const hour of ['08:17','09:17','10:17']) {
    clock = time(hour); const report = await run(runner);
    expect(report.changed).toBe(false); expect(report.failed).toBe(0);
    expect(releaseDecision({ ...permitted, DATA_CHANGED: String(report.changed), CODE_CHANGED: 'true', FORCE_BUILD: 'true' })).toEqual({ changed: false, publish: false });
  }
  expect(runner).toHaveBeenCalledTimes(6);
});
it('permits a real validated news change, keeps failed peers intact, and never leaks failure text', async () => {
  const previous = await readFile(join(root, 'public/data/earthquakes.json'), 'utf8');
  const report = await run(async (source, { directory }) => {
    if (source === 'earthquakes') throw Error('Authorization: private_test_value');
    const data = JSON.parse(await readFile(join(directory, source + '.json'), 'utf8'));
    data.fetchedAt = isoInstant(clock); data.articles[0].title = 'Synthetic newer RSS test only'; data.articles[0].publishedAt = isoInstant(clock - 60000); data.articles[0].fetchedAt = data.fetchedAt;
    await writeFile(join(directory, source + '.json'), JSON.stringify(data));
  });
  expect(report.results.find(r => r.source === 'news').status).toBe('updated');
  expect(report.results.find(r => r.source === 'earthquakes')).toMatchObject({ status: 'failed', code: 'update_failed' });
  expect(await readFile(join(root, 'public/data/earthquakes.json'), 'utf8')).toBe(previous);
  expect(JSON.stringify(report)).not.toContain('private_test_value');
  expect(releaseDecision({ ...permitted, DATA_CHANGED: String(report.changed) }).publish).toBe(true);
  expect(releaseDecision({ ...permitted, DATA_CHANGED: 'true', PUBLISH_ENABLED: 'false' }).publish).toBe(false);
});
it('weekend schedules never run quotes; an old official response cannot overwrite a newer trade date', async () => {
  const runner = vi.fn(unchanged); clock = Date.parse('2026-10-24T18:17:00+08:00');
  expect((await run(runner, ['quotes'])).results[0].status).toBe('skipped'); expect(runner).not.toHaveBeenCalled();
  clock = time('18:17'); const before = await readFile(join(root, 'public/data/quotes.json'), 'utf8');
  const report = await run(async (source, { directory }) => { const data = JSON.parse(before); data.tradeDate = '2026-10-15'; data.quotes.forEach(q => { q.date = data.tradeDate; }); data.fetchedAt = isoInstant(clock); await writeFile(join(directory, source + '.json'), JSON.stringify(data)); }, ['quotes']);
  expect(report.results[0]).toMatchObject({ status: 'failed', code: 'validation_failed' });
  expect(await readFile(join(root, 'public/data/quotes.json'), 'utf8')).toBe(before);
});
it('persists hourly attempts in status v1/checkpoint v2 and prevents duplicate runs after restore', async () => {
  const runner = vi.fn(unchanged); await run(runner); const archive = join(root, 'archive');
  await exportState(root, archive, 'a'.repeat(40)); expect(JSON.parse(await readFile(join(archive, 'manifest.json'))).version).toBe(2);
  await restoreState(root, archive, clock, { exact: true, expectedCommit: 'a'.repeat(40) });
  const state = validateState(JSON.parse(await readFile(join(root, '.cache/data-updates/status.json'))), clock);
  expect(state.sources.news.attemptedSlot).toBe('hourly');
  clock = time('08:45'); expect((await run(runner)).results.every(r => r.status === 'skipped')).toBe(true);
  expect(runner).toHaveBeenCalledTimes(2);
  // A newer local snapshot wins over the otherwise valid older checkpoint.
  const path = join(root, 'public/data/quotes.json'), data = JSON.parse(await readFile(path)); data.tradeDate = '2026-10-19'; data.quotes.forEach(q => { q.date = data.tradeDate; });
  await writeFile(path, JSON.stringify(data)); await restoreState(root, archive, clock, { expectedCommit: 'a'.repeat(40) });
  expect(JSON.parse(await readFile(path)).tradeDate).toBe('2026-10-19');
});
it('keeps a week of typical hourly checkpoints within the unchanged guard and refuses excess uploads', () => {
  const item = size => ({ size_in_bytes: size, expired: false, expires_at: '2026-10-27T00:00:00Z' });
  const artifacts = [...Array.from({ length: 16 * 7 }, () => item(100500)), ...Array.from({ length: 16 }, () => item(100500)), ...Array.from({ length: 16 }, () => item(500000))];
  expect(assertArtifactBudget(artifacts)).toBeLessThan(24 * 1024 * 1024);
  expect(() => assertArtifactBudget([...artifacts, item(180 * 1024 * 1024)])).toThrow('artifact_budget_exceeded');
});

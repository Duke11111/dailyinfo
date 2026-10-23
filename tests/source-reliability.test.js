import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { SCHEDULES, scheduleDecision, isDue } from '../scripts/lib/source-schedule.mjs';
import { SOURCES, updateData, validateState } from '../scripts/lib/data-automation.mjs';
import { updateSummary } from '../scripts/lib/update-summary.mjs';
import { exportState, restoreState } from '../scripts/lib/update-state.mjs';
import { releaseDecision } from '../scripts/lib/release-policy.mjs';
import { checkpointFixture } from './fixtures/checkpoint.js';

const base = resolve('.cache/test-results/reliability-tests');
const empty = () => ({ version: 1, sources: {} });
const time = local => Date.parse(`2026-10-20T${local}:00+08:00`);
const decision = (source, state, local, cron) => scheduleDecision(source, state, time(local), { cron });
let root, clock;
const read = source => readFile(join(root, 'public/data', `${source}.json`), 'utf8');
function fixture(source, fetchedAt = '2026-10-19T16:00:00.000Z') {
  const data = checkpointFixture(source); data.fetchedAt = fetchedAt;
  if (source === 'horoscope') data.readings.forEach(item => { item.date = '2026-10-19'; });
  return data;
}
function candidate(source, { quoteDate = '2026-10-20', horoscopeDate = '2026-10-20', changeNews = false } = {}) {
  const data = fixture(source, new Date(clock).toISOString());
  if (source === 'quotes') { data.tradeDate = quoteDate; data.quotes.forEach(item => { item.date = quoteDate; }); }
  if (source === 'horoscope') data.readings.forEach(item => { item.date = horoscopeDate; });
  if (source === 'news' && changeNews) data.articles[0].title = 'Synthetic changed test headline';
  return data;
}
const perform = (options = {}) => vi.fn(async (source, { directory }) => writeFile(join(directory, `${source}.json`), JSON.stringify(candidate(source, options))));
const run = (cron, runner, sources = SOURCES) => updateData({ root, sources, scheduled: true, cron, runner, now: () => clock });
beforeEach(async () => {
  clock = time('10:37'); await mkdir(base, { recursive: true }); root = await mkdtemp(join(base, 'case-'));
  await mkdir(join(root, 'public/data'), { recursive: true });
  for (const source of SOURCES) await writeFile(join(root, 'public/data', `${source}.json`), JSON.stringify(fixture(source)));
});
afterEach(async () => { if (!resolve(root).startsWith(base + sep)) throw Error('unsafe_cleanup'); await rm(root, { recursive: true }); });

it('maps the three UTC crons to the exact Taipei windows', () => {
  expect(SCHEDULES.map(s => [s.cron, s.minute])).toEqual([['37 2 * * *',637],['17 9 * * *',1037],['27 10 * * *',1107]]);
  for (const slot of SCHEDULES) {
    const [minute, hour] = slot.cron.split(' ').map(Number);
    expect(hour * 60 + minute + 480).toBe(slot.minute);
  }
});
it('checks news and earthquakes twice, horoscope once, and never stocks in the morning', async () => {
  const runner = perform(); const morning = await run(SCHEDULES[0].cron, runner);
  expect(runner.mock.calls.map(([s]) => s)).toEqual(['news','earthquakes','horoscope']);
  expect(morning.results.find(r => r.source === 'earthquakes')).toMatchObject({ status: 'unchanged', code: 'ok', lastSuccessAt: new Date(clock).toISOString() });
  const oldFetched = JSON.parse(await read('earthquakes')).fetchedAt;
  clock = time('17:17'); const evening = await run(SCHEDULES[1].cron, runner);
  expect(runner.mock.calls.slice(3).map(([s]) => s)).toEqual(['quotes','news','earthquakes']);
  expect(evening.results.find(r => r.source === 'horoscope').retry.reason).toBe('already_successful');
  expect(JSON.parse(await read('earthquakes')).fetchedAt).toBe(oldFetched);
  clock = time('18:27'); const recovery = await run(SCHEDULES[2].cron, runner);
  expect(recovery.results.every(r => r.status === 'skipped')).toBe(true); expect(runner).toHaveBeenCalledTimes(6);
});
it('recovers a failed evening news check without requesting successful peers again', async () => {
  const runner = perform(); await run(SCHEDULES[0].cron, runner);
  clock = time('17:17'); await run(SCHEDULES[1].cron, async (s, o) => { if (s === 'news') throw Error('private server content'); return runner(s,o); });
  runner.mockClear(); clock = time('18:27'); const report = await run(SCHEDULES[2].cron, runner);
  expect(runner.mock.calls.map(([s]) => s)).toEqual(['news']);
  expect(report.results.find(r => r.source === 'news')).toMatchObject({ status: 'unchanged', code: 'ok' });
});
it('retries failed morning horoscope in the evening while preserving the old snapshot', async () => {
  const before = await read('horoscope'), runner = perform();
  const first = await run(SCHEDULES[0].cron, async (s,o) => { if (s === 'horoscope') throw Error('private'); return runner(s,o); });
  expect(first.results.find(r => r.source === 'horoscope').status).toBe('failed'); expect(await read('horoscope')).toBe(before);
  clock = time('17:17'); await run(SCHEDULES[1].cron, runner);
  expect(JSON.parse(await read('horoscope')).readings[0].date).toBe('2026-10-20');
  clock = time('18:27'); runner.mockClear(); await run(SCHEDULES[2].cron, runner);
  expect(runner.mock.calls.map(([s]) => s)).not.toContain('horoscope');
});
it('never runs stocks before 17:00, even with a delayed or incorrect evening event', () => {
  for (const local of ['00:10','09:00','10:37','16:59']) expect(decision('quotes', empty(), local, SCHEDULES[1].cron).due).toBe(false);
});
it('recovers failed stocks at 18:27 and never repeats the same recovery window', async () => {
  clock = time('17:17'); const failed = await run(SCHEDULES[1].cron, async () => { throw Error('private'); }, ['quotes']);
  expect(failed.results[0]).toMatchObject({ status: 'failed', retry: { nextEligibleAt: new Date(time('18:27')).toISOString() } });
  clock = time('18:27'); const runner = perform(); expect((await run(SCHEDULES[2].cron, runner, ['quotes'])).results[0].status).toBe('updated');
  clock = time('23:59'); expect((await run(SCHEDULES[2].cron, runner, ['quotes'])).results[0].status).toBe('skipped'); expect(runner).toHaveBeenCalledTimes(1);
});
it('bounds persistent failures to three opportunities per day, or two for stocks', async () => {
  const runner = vi.fn(async () => { throw Error('private'); });
  for (const [local, slot] of [['10:37',0],['17:17',1],['18:27',2]]) {
    clock = time(local); await run(SCHEDULES[slot].cron, runner); await run(SCHEDULES[slot].cron, runner);
  }
  expect(runner.mock.calls.map(([s]) => s).filter(s=>s==='quotes')).toHaveLength(2);
  for (const s of ['news','earthquakes','horoscope']) expect(runner.mock.calls.filter(([name])=>name===s)).toHaveLength(3);
});
it('honors the cooldown when evening is delayed close to the recovery event', async () => {
  clock = time('18:00'); await run(SCHEDULES[1].cron, async () => { throw Error('private'); }, ['news']);
  clock = time('18:27'); const runner = perform(), report = await run(SCHEDULES[2].cron, runner, ['news']);
  expect(report.results[0]).toMatchObject({ status:'skipped', retry:{ reason:'cooldown' } }); expect(runner).not.toHaveBeenCalled();
});
it('persists the original delayed slot through checkpoint v2 and permits one later recovery', async () => {
  clock = time('21:17');
  await run(SCHEDULES[1].cron, async () => { throw Error('private'); }, ['quotes']);
  const archive = join(root, 'delayed-archive');
  await exportState(root, archive, 'a'.repeat(40));
  await restoreState(root, archive, clock, { exact: true, expectedCommit: 'a'.repeat(40) });
  const state = JSON.parse(await readFile(join(root, '.cache/data-updates/status.json'), 'utf8'));
  expect(state.sources.quotes.attemptedSlot).toBe('evening');
  expect(validateState(state, clock)).toEqual(state);
  clock = time('22:27');
  expect((await run(SCHEDULES[2].cron, perform(), ['quotes'])).results[0].status).toBe('updated');
});
it('keeps old v1 attempt timestamps conservative and rejects invalid optional slot metadata', () => {
  const legacy = { version: 1, sources: { quotes: { attemptedAt: new Date(time('21:17')).toISOString(), status: 'failed', code: 'update_failed' } } };
  expect(validateState(legacy, time('22:27'))).toEqual(legacy);
  expect(decision('quotes', legacy, '22:27', SCHEDULES[2].cron).reason).toBe('window_already_attempted');
  for (const attemptedSlot of ['', 'other', null, {}, '::error::untrusted']) {
    expect(() => validateState({ ...legacy, sources: { quotes: { ...legacy.sources.quotes, attemptedSlot } } }, time('22:27'))).toThrow('state_invalid');
  }
});
it.each([4, 5])('still checks the four sources when the evening event is delayed %s hours', async hours => {
  clock = time('17:17') + hours * 3600000;
  const runner = perform();
  const report = await run(SCHEDULES[1].cron, runner);
  expect(runner.mock.calls.map(([source]) => source)).toEqual(SOURCES);
  expect(report.results.every(item => item.status !== 'failed' && item.status !== 'skipped')).toBe(true);
  expect(JSON.parse(await read('quotes')).tradeDate).toBe('2026-10-20');
  expect(JSON.parse(await read('horoscope')).readings[0].date).toBe('2026-10-20');
});
it.each([4, 5])('recovers delayed/failed sources after a %s hour recovery delay without repeating successful ones', async hours => {
  clock = time('17:17') + hours * 3600000;
  await run(SCHEDULES[1].cron, async (source, options) => {
    if (source === 'news') throw Error('private failure');
    return perform({ quoteDate: '2026-10-19' })(source, options);
  });
  clock = time('18:27') + hours * 3600000;
  const runner = perform(), report = await run(SCHEDULES[2].cron, runner);
  expect(runner.mock.calls.map(([source]) => source)).toEqual(['quotes', 'news']);
  expect(report.results.find(item => item.source === 'quotes').status).toBe('updated');
  expect(report.results.filter(item => ['earthquakes', 'horoscope'].includes(item.source)).every(item => item.status === 'skipped')).toBe(true);
  await run(SCHEDULES[2].cron, runner);
  expect(runner).toHaveBeenCalledTimes(2);
});
it.each([1, 2])('refuses a slot %s event delayed across Taiwan midnight without touching snapshots or source status', async slot => {
  const before = await Promise.all(SOURCES.map(read));
  clock = Date.parse('2026-10-21T00:05:00+08:00');
  const runner = perform(), report = await run(SCHEDULES[slot].cron, runner);
  expect(runner).not.toHaveBeenCalled();
  expect(report.changed).toBe(false);
  expect(report.results.every(item => item.status === 'skipped' && item.retry.reason === 'before_window')).toBe(true);
  expect(await Promise.all(SOURCES.map(read))).toEqual(before);
  expect(JSON.parse(await readFile(join(root, '.cache/data-updates/status.json'), 'utf8')).sources).toEqual({});
  expect(releaseDecision({ EVENT: 'schedule', DATA_CHANGED: String(report.changed), AUTO_PUBLISH_ENABLED: 'true', FREE_USAGE_CONFIRMED: 'true', PUBLISH_ENABLED: 'true', DEPLOY_TARGET: 'pages' }).publish).toBe(false);
});
it('keeps weekday holiday/late quotes unchanged, distinct from schema errors, and retries only once later', async () => {
  clock = time('17:17'); const before = await read('quotes'), runner = perform({quoteDate:'2026-10-16'});
  const result = await run(SCHEDULES[1].cron, runner, ['quotes']);
  expect(result.results[0]).toMatchObject({ status:'unchanged', code:'source_delayed', lastSuccessAt:null, sourceDate:'2026-10-16' });
  expect(await read('quotes')).toBe(before); expect(result.changed).toBe(false);
  clock = time('18:27'); await run(SCHEDULES[2].cron, runner, ['quotes']); await run(SCHEDULES[2].cron, runner, ['quotes']);
  expect(runner).toHaveBeenCalledTimes(2);
});
it('accepts a genuinely newer valid prior trading day without pretending it is today', async () => {
  clock = time('17:17'); const report = await run(SCHEDULES[1].cron, perform({ quoteDate:'2026-10-19' }), ['quotes']);
  expect(report.results[0]).toMatchObject({ status:'updated', code:'source_delayed', sourceDate:'2026-10-19', lastSuccessAt:null });
  expect(JSON.parse(await read('quotes')).tradeDate).toBe('2026-10-19');
});
it('rejects regression of newer quotes rather than treating it as source delay', async () => {
  clock = time('17:17'); await run(SCHEDULES[1].cron, perform(), ['quotes']); const before = await read('quotes');
  clock = time('18:27'); const report = await updateData({ root, sources:['quotes'], now:()=>clock, runner:perform({quoteDate:'2026-10-19'}) });
  expect(report.results[0]).toMatchObject({ status:'failed', code:'validation_failed' }); expect(await read('quotes')).toBe(before);
});
it('never publishes yesterday horoscope as today and leaves it eligible for the next window', async () => {
  const before = await read('horoscope');
  const report = await run(SCHEDULES[0].cron, perform({horoscopeDate:'2026-10-19'}), ['horoscope']);
  expect(report.results[0]).toMatchObject({ status:'unchanged', code:'source_delayed', lastSuccessAt:null }); expect(await read('horoscope')).toBe(before);
  expect(report.changed).toBe(false); clock=time('17:17'); expect((await run(SCHEDULES[1].cron, perform(), ['horoscope'])).results[0].status).toBe('updated');
});
it('fails closed for malformed scheduled cron before any runner call', async () => {
  const runner = perform(); await expect(run('untrusted cron', runner)).rejects.toThrow('schedule_cron_invalid'); expect(runner).not.toHaveBeenCalled();
});
it('uses actual Taipei date across midnight and keeps weekends free of quote requests', async () => {
  const old = { version:1,sources:{horoscope:{ attemptedAt:'2026-10-19T02:37:00Z',lastSuccessAt:'2026-10-19T02:37:00Z',status:'updated',code:'ok' }} };
  expect(isDue('horoscope', old, Date.parse('2026-10-19T16:05:00Z'),{cron:SCHEDULES[2].cron})).toBe(false);
  expect(isDue('horoscope', old,time('10:37'),{cron:SCHEDULES[0].cron})).toBe(true);
  clock=Date.parse('2026-10-24T17:17:00+08:00'); const runner=perform(); const report=await run(SCHEDULES[1].cron,runner,['quotes']);
  expect(report.results[0].retry.reason).toBe('weekend'); expect(runner).not.toHaveBeenCalled();
});
it('treats a delayed morning event as one morning window, never an extra evening retry', async () => {
  clock=time('15:37');const runner=perform();await run(SCHEDULES[0].cron,runner);
  expect(runner.mock.calls.map(([s])=>s)).not.toContain('quotes');
  clock=time('15:47');const second=await run(SCHEDULES[0].cron,runner);expect(runner).toHaveBeenCalledTimes(3);
  expect(second.results.every(r=>Date.parse(r.retry.nextEligibleAt)>clock)).toBe(true);
});
it('preserves old status v1 and checkpoint v2 while round-tripping source_delayed state', async () => {
  const old={version:1,sources:{news:{attemptedAt:'2026-10-19T02:37:00Z',status:'failed',code:'update_failed'}}};
  expect(validateState(old,clock)).toEqual(old);
  clock=time('17:17');await run(SCHEDULES[1].cron,perform({quoteDate:'2026-10-16'}),['quotes']);
  const archive=join(root,'archive');await exportState(root,archive,'a'.repeat(40));
  expect(JSON.parse(await readFile(join(archive,'manifest.json'))).version).toBe(2);
  await restoreState(root,archive,clock,{exact:true,expectedCommit:'a'.repeat(40)});
  expect(JSON.parse(await readFile(join(root,'.cache/data-updates/status.json'))).sources.quotes.code).toBe('source_delayed');
  const before=await read('quotes');await writeFile(join(archive,'news.json'),'{}');await expect(restoreState(root,archive,clock)).rejects.toThrow('checksum');expect(await read('quotes')).toBe(before);
});
it('keeps manual updates explicit and independent from schedule windows', async () => {
  clock=time('08:00');const runner=perform();await updateData({root,sources:['news'],now:()=>clock,runner});expect(runner).toHaveBeenCalledTimes(1);
});
it('does not accept a delayed code for failed or unrelated source state', () => {
  for (const [source,status] of [['news','unchanged'],['quotes','failed']]) {
    expect(()=>validateState({version:1,sources:{[source]:{attemptedAt:new Date(clock).toISOString(),status,code:'source_delayed'}}},clock)).toThrow('state_invalid');
  }
});
it('summarizes safe timestamps, failures, missing freshness and retry reasons without arbitrary errors', async () => {
  const runner=perform({changeNews:true});const report=await run(SCHEDULES[0].cron,async(s,o)=>{if(s==='horoscope')throw Error('Authorization: private-test-value');return runner(s,o);});
  const summary=updateSummary(report);expect(summary).toContain('updated / ok');expect(summary).toContain('unchanged / ok');expect(summary).toContain('skipped / not_due');expect(summary).toContain('failed / update_failed');expect(summary).toContain('Last successful');expect(summary).toContain('next window');expect(summary).not.toContain('private-test-value');
  expect(()=>updateSummary({...report,results:[{...report.results[0],code:'::error:: arbitrary server content'}]})).toThrow('summary_invalid');
  expect(releaseDecision({EVENT:'schedule',DATA_CHANGED:String(report.changed),PUBLISH_ENABLED:'false',DEPLOY_TARGET:'pages'}).publish).toBe(false);
});

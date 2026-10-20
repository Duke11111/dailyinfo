import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { SOURCES, CORE_SOURCES, selectUpdateSources, updateData, validateData, validateState, isDue, contentDigest, assertPublicSafe, verifyPublicTree } from '../scripts/lib/data-automation.mjs';
import { exportState, restoreState } from '../scripts/lib/update-state.mjs';
import { snapshotTarget } from '../scripts/lib/snapshot-target.mjs';
import { quoteFixture } from './fixtures/quotes.js';
import { newsFixture } from './fixtures/news.js';
import { eqFixture } from './fixtures/earthquakes.js';
import { SIGNS } from '../src/services/horoscope.js';

const captured = '2026-10-20T01:00:00.000Z', now = () => Date.parse(captured);
const fixture = source => ({ quotes: quoteFixture, news: newsFixture, earthquakes: eqFixture, horoscope: () => ({ version: 1, source: 'https://freehoroscopeapi.com', language: 'en', fetchedAt: captured, readings: SIGNS.map(sign => ({ sign: sign.code, date: '2026-10-20', text: 'Synthetic test only.' })) }) })[source]();
const base = resolve('.cache/automation-tests'); let root;
const path = source => join(root, 'public/data', `${source}.json`);
const read = source => readFile(path(source), 'utf8');
async function seed() { for (const source of SOURCES) await writeFile(path(source), JSON.stringify(fixture(source))); }
function runner(transform = data => data) { return vi.fn(async (source, { directory }) => { const data = fixture(source); data.fetchedAt = captured; await writeFile(join(directory, `${source}.json`), JSON.stringify(transform(data, source))); }); }
beforeEach(async () => { await mkdir(base, { recursive: true }); root = await mkdtemp(join(base, 'test-')); await mkdir(join(root, 'public/data'), { recursive: true }); await seed(); });
afterEach(async () => { vi.unstubAllEnvs(); if (!resolve(root).startsWith(base + sep)) throw Error('Cleanup outside test workspace'); await rm(root, { recursive: true }); });

it('scheduled core isolates a failure, preserves all valid snapshots and throttles the next attempt', async () => {
  const before = Object.fromEntries(await Promise.all(SOURCES.map(async source => [source, await read(source)])));
  const clock = () => Date.parse('2026-10-20T10:17:00Z'), perform = runner();
  const options = { root, sources: selectUpdateSources('core', true), scheduled: true, now: clock, runner: async (source, settings) => {
    if (source === 'news') throw Error('synthetic private failure');
    await perform(source, settings);
  } };
  const report = await updateData(options);
  expect(report.failed).toBe(1); expect(report.results.map(item => item.source)).toEqual(CORE_SOURCES);
  expect(report.results.find(item => item.source === 'news')).toMatchObject({ status: 'failed', code: 'update_failed' });
  expect(perform.mock.calls.map(([source]) => source)).toEqual(['quotes', 'earthquakes', 'horoscope']);
  for (const source of SOURCES) expect(await read(source)).toBe(before[source]);
  expect(JSON.stringify(report)).not.toContain('synthetic private failure');
  const next = await updateData(options);
  expect(next.results.every(item => item.status === 'skipped')).toBe(true);
  expect(perform).toHaveBeenCalledTimes(3);
});

it.each(SOURCES)('validates %s with actual module schema and updates independently', async source => {
  const before = Object.fromEntries(await Promise.all(SOURCES.map(async name => [name, await read(name)])));
  const result = await updateData({ root, sources: [source], now, runner: runner() });
  expect(result.failed).toBe(0); expect(result.changed).toBe(false);
  for (const name of SOURCES) expect(await read(name)).toBe(before[name]);
  expect(validateData(source, JSON.parse(await read(source)), now())).toBeTruthy();
});
it('publishes only a validated substantive change and preserves other sources', async () => {
  const before = await read('quotes'); const report = await updateData({ root, sources: ['news'], now, runner: runner(data => { data.articles[0].title = 'Updated synthetic fixture'; return data; }) });
  expect(report.changed).toBe(true); expect(report.results[0].status).toBe('updated'); expect(JSON.parse(await read('news')).articles[0].title).toBe('Updated synthetic fixture'); expect(await read('quotes')).toBe(before);
});
it('continues after a failed source without logging arbitrary secret-bearing errors', async () => {
  const before = await read('quotes'); const perform = runner(data => { data.articles[0].title = 'Updated fixture'; return data; });
  const report = await updateData({ root, sources: ['quotes', 'news'], now, runner: async (source, options) => { if (source === 'quotes') { await writeFile(join(options.directory, 'quotes.json'), '{}'); throw Error('Authorization: test-private-value'); } await perform(source, options); } });
  expect(report.failed).toBe(1); expect(report.changed).toBe(true); expect(await read('quotes')).toBe(before); expect(JSON.stringify(report)).not.toContain('test-private-value'); expect(report.results[0].code).toBe('update_failed');
});
it.each(['invalid', 'old', 'future', 'secret'])('preserves old bytes after %s candidate validation fails', async mode => {
  const before = await read('horoscope'); const report = await updateData({ root, sources: ['horoscope'], now, runner: runner(data => {
    if (mode === 'invalid') data.readings.pop(); if (mode === 'old') data.readings.forEach(item => item.date = '2026-10-19'); if (mode === 'future') data.fetchedAt = '2099-01-01T00:00:00Z'; if (mode === 'secret') data.readings[0].text = 'CWA-' + 'a'.repeat(30); return data;
  }) }); expect(report.failed).toBe(1); expect(await read('horoscope')).toBe(before);
});
it('does not overwrite a corrupt baseline and removes only its own temporary directory', async () => { await writeFile(path('quotes'), 'corrupt'); const report = await updateData({ root, sources: ['quotes'], now, runner: runner() }); expect(report.failed).toBe(1); expect(await read('quotes')).toBe('corrupt'); expect(await readdir(join(root, '.cache/data-updates'))).toEqual(expect.arrayContaining(['status.json', 'report.json'])); expect((await readdir(join(root, '.cache/data-updates'))).some(name => name.startsWith('run-') || name === 'lock')).toBe(false); });
it('holds a local single-run lock and rejects unknown or duplicate sources', async () => { await mkdir(join(root, '.cache/data-updates/lock'), { recursive: true }); await expect(updateData({ root, now, runner: runner() })).rejects.toThrow('update_locked'); await expect(updateData({ root, sources: ['news', 'news'] })).rejects.toThrow(); await expect(updateData({ root, sources: ['../bad'] })).rejects.toThrow(); });
it('throttles recurring sources and skips duplicate daily attempts including failures', async () => {
  const perform = runner(); await updateData({ root, sources: ['horoscope', 'news'], now, runner: perform }); const result = await updateData({ root, sources: ['horoscope', 'news'], scheduled: true, now, runner: perform }); expect(result.results.every(item => item.status === 'skipped')).toBe(true); expect(perform).toHaveBeenCalledTimes(2);
  expect(isDue('news', { sources: { news: { attemptedAt: captured } } }, now() + 3 * 3600000)).toBe(true);
});
it('rejects corrupt/future scheduling state instead of silently disabling updates', () => { expect(() => validateState({ version: 1, sources: { news: { attemptedAt: '2099-01-01T00:00:00Z', status: 'failed', code: 'update_failed' } } }, now())).toThrow(); expect(() => validateState({ version: 1, sources: { unknown: {} } })).toThrow(); });
it('uses isolated output paths while preserving the ordinary local defaults', () => { vi.stubEnv('DAILYINFO_DATA_DIR', join(root, 'isolated')); expect(snapshotTarget('quotes')).toBe(join(root, 'isolated/quotes.json')); expect(() => snapshotTarget('../key')).toThrow(); });
it('suppresses stdout/stderr from an actual failing Node updater process', async () => {
  await mkdir(join(root, 'scripts')); await writeFile(join(root, 'scripts/update-quotes.mjs'), "console.log('private-test-token'); console.error('private-test-token'); process.exit(1);");
  const before = await read('quotes'), report = await updateData({ root, sources: ['quotes'], now }); expect(report.failed).toBe(1); expect(JSON.stringify(report)).not.toContain('private-test-token'); expect(await read('quotes')).toBe(before);
});
it('rejects exact secret values, credential fields and forbidden public files', async () => { expect(() => assertPublicSafe('test-private-key', ['test-private-key'])).toThrow(); expect(() => assertPublicSafe({ Authorization: 'anything' })).toThrow(); await writeFile(join(root, 'public/data/unsafe.json'), 'test-private-key'); await expect(verifyPublicTree(join(root, 'public'), ['test-private-key'])).rejects.toThrow(); await rm(join(root, 'public/data/unsafe.json')); await writeFile(join(root, 'public/.env.local'), 'not-a-real-key'); await expect(verifyPublicTree(join(root, 'public'))).rejects.toThrow(); });
it('exports and validates a persistent checkpoint before restoring any files', async () => {
  await updateData({ root, sources: ['news'], now, runner: runner() }); const dir = join(root, 'checkpoint'); await exportState(root, dir, 'a'.repeat(40)); const restored = await restoreState(root, dir, now()); expect(restored.commit).toBe('a'.repeat(40)); const before = await read('quotes'); await writeFile(join(dir, 'news.json'), '{}'); await expect(restoreState(root, dir, now())).rejects.toThrow('checksum'); expect(await read('quotes')).toBe(before);
});
it('checkpoint-only rejects bad checksum or provenance before writing any snapshot', async () => {
  await updateData({ root, sources: ['news'], now, runner: runner() }); const dir = join(root, 'exact-checkpoint'), commit = 'a'.repeat(40); await exportState(root, dir, commit);
  const before = await read('quotes');
  await expect(restoreState(root, dir, now(), { exact: true, expectedCommit: 'b'.repeat(40) })).rejects.toThrow('approval');
  await writeFile(join(dir, 'news.json'), '{}'); await expect(restoreState(root, dir, now(), { exact: true, expectedCommit: commit })).rejects.toThrow('checksum'); expect(await read('quotes')).toBe(before);
});

it('all and core select the same four active sources and reject retired sources', () => {
  expect(selectUpdateSources('all')).toEqual(['quotes', 'news', 'earthquakes', 'horoscope']);
  expect(selectUpdateSources('core')).toEqual(SOURCES);
  expect(() => selectUpdateSources('exchange')).toThrow('unknown_source');
});
it('workflow preserves all opt-in and publishing guards with four sources', async () => {
  const workflow = await readFile(resolve('.github/workflows/data-update.yml'), 'utf8');
  expect(workflow).toContain('options: [all, core, quotes, news, earthquakes, horoscope, checkpoint]');
  expect(workflow).toContain("vars.DATA_SCHEDULE_ENABLED == 'true'");
  expect(workflow).toContain("vars.DATA_AUTOMATION_ENABLED == 'true'");
  expect(workflow).toContain("vars.DATA_PUBLISH_ENABLED == 'true'");
  expect(workflow).toContain("vars.DATA_DEPLOY_TARGET == 'pages'");
  expect(workflow).toContain('npm run update:data -- --sources=core --scheduled');
  expect(workflow).not.toMatch(/exchange|push:|contents: write/);
});

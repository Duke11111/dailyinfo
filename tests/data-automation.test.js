import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { SOURCES, updateData, validateData, validateState, isDue, contentDigest, assertPublicSafe, verifyPublicTree } from '../scripts/lib/data-automation.mjs';
import { exportState, restoreState } from '../scripts/lib/update-state.mjs';
import { snapshotTarget } from '../scripts/lib/snapshot-target.mjs';
import { quoteFixture } from './fixtures/quotes.js';
import { newsFixture } from './fixtures/news.js';
import { eqFixture } from './fixtures/earthquakes.js';
import { exchangeFixture } from './fixtures/exchange.js';
import { SIGNS } from '../src/services/horoscope.js';

const captured = '2026-10-20T01:00:00.000Z', now = () => Date.parse(captured);
const fixture = source => ({ quotes: quoteFixture, news: newsFixture, earthquakes: eqFixture, exchange: exchangeFixture, horoscope: () => ({ version: 1, source: 'https://freehoroscopeapi.com', language: 'en', fetchedAt: captured, readings: SIGNS.map(sign => ({ sign: sign.code, date: '2026-10-20', text: 'Synthetic test only.' })) }) })[source]();
const base = resolve('.cache/automation-tests'); let root;
const path = source => join(root, 'public/data', `${source}.json`);
const read = source => readFile(path(source), 'utf8');
async function seed() { for (const source of SOURCES) await writeFile(path(source), JSON.stringify(fixture(source))); }
function runner(transform = data => data) { return vi.fn(async (source, { directory }) => { const data = fixture(source); data.fetchedAt = captured; await writeFile(join(directory, `${source}.json`), JSON.stringify(transform(data, source))); }); }
beforeEach(async () => { await mkdir(base, { recursive: true }); root = await mkdtemp(join(base, 'test-')); await mkdir(join(root, 'public/data'), { recursive: true }); await seed(); });
afterEach(async () => { vi.unstubAllEnvs(); if (!resolve(root).startsWith(base + sep)) throw Error('Cleanup outside test workspace'); await rm(root, { recursive: true }); });

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
it('daily cutoffs use Taiwan date, avoid weekends and allow late scheduled runs', () => {
  const empty = { version: 1, sources: {} }, monday1730 = Date.parse('2026-10-19T09:30:00Z');
  expect(isDue('quotes', empty, monday1730)).toBe(true); expect(isDue('quotes', empty, Date.parse('2026-10-19T08:59:00Z'))).toBe(false); expect(isDue('quotes', empty, Date.parse('2026-10-18T10:00:00Z'))).toBe(false);
  expect(isDue('exchange', empty, Date.parse('2026-10-19T07:17:00Z'))).toBe(true); expect(isDue('horoscope', empty, Date.parse('2026-10-19T00:59:00Z'))).toBe(false); expect(isDue('horoscope', empty, Date.parse('2026-10-19T01:17:00Z'))).toBe(true);
  expect(isDue('quotes', { sources: { quotes: { attemptedAt: '2026-10-19T02:00:00Z' } } }, monday1730)).toBe(true);
  expect(isDue('quotes', { sources: { quotes: { attemptedAt: '2026-10-19T09:17:00Z' } } }, monday1730)).toBe(false);
});
it('throttles recurring sources and skips duplicate daily attempts including failures', async () => {
  const perform = runner(); await updateData({ root, sources: ['horoscope', 'news'], now, runner: perform }); const result = await updateData({ root, sources: ['horoscope', 'news'], scheduled: true, now, runner: perform }); expect(result.results.every(item => item.status === 'skipped')).toBe(true); expect(perform).toHaveBeenCalledTimes(2);
  expect(isDue('news', { sources: { news: { attemptedAt: captured } } }, now() + 3 * 3600000)).toBe(true);
});
it('rejects corrupt/future scheduling state instead of silently disabling updates', () => { expect(() => validateState({ version: 1, sources: { news: { attemptedAt: '2099-01-01T00:00:00Z', status: 'failed', code: 'update_failed' } } }, now())).toThrow(); expect(() => validateState({ version: 1, sources: { unknown: {} } })).toThrow(); });
it('ignores fetch/hash bookkeeping but preserves real source date/content in release digest', () => { const a = fixture('news'), b = structuredClone(a); b.fetchedAt = captured; b.feeds[0].sha256 = 'b'.repeat(64); expect(contentDigest(a)).toBe(contentDigest(b)); b.articles[0].title += 'new'; expect(contentDigest(a)).not.toBe(contentDigest(b)); const q = fixture('exchange'), q2 = structuredClone(q); q2.quotedAt = '2026-10-20T01:00:00+08:00'; expect(contentDigest(q)).not.toBe(contentDigest(q2)); });
it('uses isolated output paths while preserving the ordinary local defaults', () => { vi.stubEnv('DAILYINFO_DATA_DIR', join(root, 'isolated')); expect(snapshotTarget('quotes')).toBe(join(root, 'isolated/quotes.json')); expect(() => snapshotTarget('../key')).toThrow(); });
it('suppresses stdout/stderr from an actual failing Node updater process', async () => {
  await mkdir(join(root, 'scripts')); await writeFile(join(root, 'scripts/update-quotes.mjs'), "console.log('private-test-token'); console.error('private-test-token'); process.exit(1);");
  const before = await read('quotes'), report = await updateData({ root, sources: ['quotes'], now }); expect(report.failed).toBe(1); expect(JSON.stringify(report)).not.toContain('private-test-token'); expect(await read('quotes')).toBe(before);
});
it('rejects exact secret values, credential fields and forbidden public files', async () => { expect(() => assertPublicSafe('test-private-key', ['test-private-key'])).toThrow(); expect(() => assertPublicSafe({ Authorization: 'anything' })).toThrow(); await writeFile(join(root, 'public/data/unsafe.json'), 'test-private-key'); await expect(verifyPublicTree(join(root, 'public'), ['test-private-key'])).rejects.toThrow(); await rm(join(root, 'public/data/unsafe.json')); await writeFile(join(root, 'public/.env.local'), 'not-a-real-key'); await expect(verifyPublicTree(join(root, 'public'))).rejects.toThrow(); });
it('exports and validates a persistent checkpoint before restoring any files', async () => {
  await updateData({ root, sources: ['news'], now, runner: runner() }); const dir = join(root, 'checkpoint'); await exportState(root, dir, 'a'.repeat(40)); const restored = await restoreState(root, dir, now()); expect(restored.commit).toBe('a'.repeat(40)); const before = await read('quotes'); await writeFile(join(dir, 'news.json'), '{}'); await expect(restoreState(root, dir, now())).rejects.toThrow('checksum'); expect(await read('quotes')).toBe(before);
});
it('keeps manually committed fresher data when restoring a previous checkpoint', async () => {
  await updateData({ root, sources: ['news'], now, runner: runner() }); const dir = join(root, 'checkpoint'); await exportState(root, dir);
  const value = fixture('exchange'); value.fetchedAt = captured; value.quotedAt = '2026-10-20T08:00:00+08:00'; await writeFile(path('exchange'), JSON.stringify(value)); await restoreState(root, dir, now()); expect(JSON.parse(await read('exchange')).quotedAt).toBe(value.quotedAt);
});
it('workflow is opt-in, default-branch only and scopes secrets away from build/deploy', async () => {
  const workflow = await readFile(resolve('.github/workflows/data-update.yml'), 'utf8'); expect(workflow).toContain("vars.DATA_AUTOMATION_ENABLED == 'true'"); expect(workflow).toContain('github.event.repository.default_branch'); expect(workflow).toContain('cancel-in-progress: false'); expect(workflow).toContain('workflow_dispatch:'); expect(workflow).not.toMatch(/^\s+(?:schedule|push|pull_request|workflow_run):/m); expect(workflow).not.toContain('git push'); expect(workflow).not.toContain('contents: write'); expect(workflow).toContain("needs.deploy.result == 'success' || needs.deploy.result == 'skipped'");
  const build = workflow.slice(workflow.indexOf('- name: Test and build'), workflow.indexOf('- name: Verify built')); expect(build).not.toContain('CWA_API_KEY:'); expect(workflow).toContain("vars.DATA_PUBLISH_ENABLED == 'true'");
});

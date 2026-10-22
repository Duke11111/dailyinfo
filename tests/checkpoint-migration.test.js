import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { SOURCES, validateState, updateData, selectUpdateSources } from '../scripts/lib/data-automation.mjs';
import { exportState, restoreState } from '../scripts/lib/update-state.mjs';
import { CHECKPOINT_NOW, checkpointFixture } from './fixtures/checkpoint.js';
// Vite ignores **/test-results/**; keep rapidly replaced JSON outside dev watchers.
const base = resolve('.cache/test-results/migration-tests'), now = CHECKPOINT_NOW, commit = 'a'.repeat(40);
const hash = text => createHash('sha256').update(text).digest('hex');
let root, archive;
// Synthetic retired v1 archive only; never a public snapshot or an updater fixture.
const retired = () => ({ version: 1, source: '臺灣銀行', sourceUrl: 'https://rate.bot.com.tw/xrt?Lang=zh-TW', downloadUrl: 'https://rate.bot.com.tw/xrt/flcsv/0/day', licenseUrl: 'https://data.gov.tw/license', base: 'TWD', unit: 1,
  quotedAt: '2026-10-20T00:42:00+08:00', fetchedAt: '2026-10-20T01:00:00.000Z',
  rates: 'USD JPY EUR GBP HKD CNY KRW AUD CAD SGD CHF ZAR SEK NZD THB PHP IDR VND MYR'.split(' ').map(code => ({ code, name: code, cash: { buy: 1, sell: 2 }, spot: { buy: null, sell: null } })), evidence: null });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  await mkdir(base, { recursive: true }); root = await mkdtemp(join(base, 'case-')); archive = join(root, 'archive');
  await mkdir(join(root, 'public/data'), { recursive: true }); await mkdir(join(root, '.cache/data-updates'), { recursive: true });
  for (const source of SOURCES) await writeFile(join(root, 'public/data', source + '.json'), JSON.stringify(checkpointFixture(source)));
  await writeFile(join(root, '.cache/data-updates/status.json'), JSON.stringify({ version: 1, sources: {} }));
});
afterEach(async () => { vi.useRealTimers(); if (!resolve(root).startsWith(base + sep)) throw Error('unsafe cleanup'); await rm(root, { recursive: true }); });
async function legacy() {
  await exportState(root, archive, commit);
  const text = JSON.stringify(retired()); await writeFile(join(archive, 'exchange.json'), text);
  const status = JSON.stringify({ version: 1, sources: { news: { attemptedAt: '2026-10-20T10:00:00Z', status: 'unchanged', code: 'ok' }, exchange: { attemptedAt: '2026-10-20T10:07:19Z', status: 'failed', code: 'quote_time_error' } } });
  await writeFile(join(archive, 'status.json'), status);
  const m = JSON.parse(await readFile(join(archive, 'manifest.json'))); m.version = 1; m.hashes['exchange.json'] = hash(text); m.hashes['status.json'] = hash(status);
  await writeFile(join(archive, 'manifest.json'), JSON.stringify(m));
}
async function change(name, value, rehash = true) {
  const text = typeof value === 'string' ? value : JSON.stringify(value); await writeFile(join(archive, name), text);
  if (rehash) { const m = JSON.parse(await readFile(join(archive, 'manifest.json'))); m.hashes[name] = hash(text); await writeFile(join(archive, 'manifest.json'), JSON.stringify(m)); }
}
async function bytes() { return Promise.all([...SOURCES.map(s => 'public/data/' + s + '.json'), '.cache/data-updates/status.json'].map(p => readFile(join(root, p), 'utf8'))); }
it('exports v2 with exactly four snapshots, status and manifest', async () => {
  await exportState(root, archive, commit); expect((await readdir(archive)).sort()).toEqual(['earthquakes.json','horoscope.json','manifest.json','news.json','quotes.json','status.json']);
  expect(JSON.parse(await readFile(join(archive, 'manifest.json'))).version).toBe(2);
  expect((await restoreState(root, archive, now, { exact: true, expectedCommit: commit })).migrated).toBe(false);
});
it.each([false, true])('fully validates v1 before migrating, exact=%s, without restoring retired files', async exact => {
  await legacy(); const before = await bytes(); const m = await restoreState(root, archive, now, { exact, expectedCommit: commit });
  expect(m.migrated).toBe(true); expect((await bytes()).slice(0, 4)).toEqual(before.slice(0, 4));
  const status = JSON.parse(await readFile(join(root, '.cache/data-updates/status.json')));
  expect(Object.keys(status.sources)).toEqual(['news']); expect(status.sources.news.code).toBe('ok');
  expect(await readdir(join(root, 'public/data'))).not.toContain('exchange.json');
  const next = join(root, 'next'); await exportState(root, next, 'b'.repeat(40));
  expect(JSON.parse(await readFile(join(next, 'manifest.json'))).version).toBe(2);
  expect(await readdir(next)).toHaveLength(6); expect(await readdir(archive)).toHaveLength(7);
});
it.each([false, true])('retains newer-data versus exact-approval policy, exact=%s', async exact => {
  await legacy(); const approved = await readFile(join(archive, 'news.json'), 'utf8');
  const newer = JSON.parse(approved); newer.fetchedAt = '2026-10-20T12:00:00.000Z';
  const text = JSON.stringify(newer); await writeFile(join(root, 'public/data/news.json'), text);
  await restoreState(root, archive, now, { exact, expectedCommit: commit });
  expect(await readFile(join(root, 'public/data/news.json'), 'utf8')).toBe(exact ? approved : text);
});
it('refuses to overwrite an old archive with an incompatible export', async () => {
  await legacy(); const before = await readFile(join(archive, 'manifest.json'), 'utf8');
  await expect(exportState(root, archive, commit)).rejects.toThrow();
  expect(await readFile(join(archive, 'manifest.json'), 'utf8')).toBe(before);
});
it.each(['checksum','schema','date','status','missing','extra','provenance','secret','manifest'])('rejects legacy %s before changing any active bytes', async mode => {
  await legacy(); const before = await bytes();
  if (mode === 'checksum') await change('exchange.json', '{}', false);
  if (mode === 'schema') { const v = retired(); v.rates.pop(); await change('exchange.json', v); }
  if (mode === 'date') { const v = retired(); v.fetchedAt = '2099-01-01T00:00:00.000Z'; await change('exchange.json', v); }
  if (mode === 'status') await change('status.json', { version: 1, sources: { exchange: { attemptedAt: '2026-10-20T10:00:00Z', status: 'failed', code: 'untrusted' } } });
  if (mode === 'missing') await rm(join(archive, 'exchange.json'));
  if (mode === 'extra') await writeFile(join(archive, 'untrusted.json'), '{}');
  if (mode === 'secret') { const v = retired(); v.password = 'synthetic'; await change('exchange.json', v); }
  if (mode === 'manifest') { const m = JSON.parse(await readFile(join(archive, 'manifest.json'))); m.hashes['extra.json'] = 'a'.repeat(64); await writeFile(join(archive, 'manifest.json'), JSON.stringify(m)); }
  await expect(restoreState(root, archive, now, { exact: true, expectedCommit: mode === 'provenance' ? 'b'.repeat(40) : commit })).rejects.toThrow();
  expect(await bytes()).toEqual(before);
});
it.each(SOURCES)('isolates %s failure while retaining all four sources', async failed => {
  const before = await bytes(); const runner = vi.fn(async (source, { directory }) => { if (source === failed) throw Error('private synthetic failure'); await writeFile(join(directory, source + '.json'), await readFile(join(root, 'public/data', source + '.json'))); });
  const result = await updateData({ root, sources: selectUpdateSources('all'), runner, now: () => now });
  expect(runner.mock.calls.map(([s]) => s)).toEqual(SOURCES); expect(result.failed).toBe(1);
  expect((await bytes()).slice(0, 4)).toEqual(before.slice(0, 4)); expect(JSON.stringify(result)).not.toContain('private synthetic failure');
});
it('rejects the retired source and status rather than silently running or accepting it', async () => {
  expect(() => selectUpdateSources('exchange')).toThrow();
  expect(() => validateState({ version: 1, sources: { exchange: {} } })).toThrow();
  const runner = vi.fn(); await expect(updateData({ root, sources: ['exchange'], runner })).rejects.toThrow(); expect(runner).not.toHaveBeenCalled();
});
it.each(SOURCES)('rejects a checksummed future %s snapshot without changing active data', async source => {
  await exportState(root, archive, commit); const before = await bytes();
  const future = checkpointFixture(source); future.fetchedAt = new Date(now + 6 * 60000).toISOString();
  await change(source + '.json', future);
  await expect(restoreState(root, archive, now, { exact: true, expectedCommit: commit })).rejects.toThrow('future_snapshot');
  expect(await bytes()).toEqual(before);
});
it('accepts newer valid news through the unchanged updater and preserves other sources', async () => {
  const before = await bytes();
  const newer = checkpointFixture('news'); newer.fetchedAt = '2026-10-20T11:45:00.000Z';
  newer.articles[0] = { ...newer.articles[0], title: 'New synthetic checkpoint news',
    publishedAt: '2026-10-20T11:30:00.000Z', fetchedAt: newer.fetchedAt };
  const runner = vi.fn(async (source, { directory }) => writeFile(join(directory, source + '.json'), JSON.stringify(newer)));
  const result = await updateData({ root, sources: ['news'], runner, now: () => now });
  expect(result.failed).toBe(0); expect(result.results[0]).toMatchObject({ source: 'news', status: 'updated', code: 'ok' });
  expect(JSON.parse(await readFile(join(root, 'public/data/news.json'))).articles[0].publishedAt).toBe(newer.articles[0].publishedAt);
  const after = await bytes(); for (const index of [0, 2, 3]) expect(after[index]).toEqual(before[index]);
});

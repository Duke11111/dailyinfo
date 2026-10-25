import { it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { compareSnapshots, snapshotSourceDate } from '../src/lib/snapshot-freshness.js';
import { createSnapshotStore } from '../src/services/snapshot-store.js';
import { validateData, SOURCES } from '../scripts/lib/data-automation.mjs';
import { mergeLocalBaseline, materializeCheckpoint } from '../scripts/lib/local-baseline.mjs';
import { checkpointFixture, CHECKPOINT_NOW } from './fixtures/checkpoint.js';
const roots = [];
afterEach(async () => { vi.useRealTimers(); for (const root of roots.splice(0)) { if (!root.startsWith(resolve('.cache/test-results/latest-valid') + sep)) throw Error('unsafe cleanup'); await rm(root, { recursive: true }); } });
const memory = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }; };
const fixture = (source, hour) => ({ ...checkpointFixture(source), fetchedAt: `2026-10-20T${hour}:00:00.000Z` });
it.each(['expired', 'checksum'])('rejects %s offline checkpoint before extracting or merging any file', async kind => {
  const metadata = { expiresAt: kind === 'expired' ? '2000-01-01T00:00:00Z' : '2099-01-01T00:00:00Z', commit: 'a'.repeat(40), digest: 'sha256:' + 'b'.repeat(64) };
  await expect(materializeCheckpoint(process.cwd(), metadata, Buffer.from('not an authenticated archive'))).rejects.toMatchObject({ code: 'BASELINE_INVALID' });
});
it.each(SOURCES)('%s: old cache never overwrites a newer snapshot, while a newer snapshot replaces old cache', async source => {
  const storage = memory(), key = `dailyinfo.cache.${source}.v1`, old = fixture(source, '10'), next = fixture(source, '11');
  const validate = raw => validateData(source, raw, CHECKPOINT_NOW);
  const options = { name: source, storage, validate, now: () => CHECKPOINT_NOW, sourceDay: value => snapshotSourceDate(source, value), ttl: 3600000 };
  storage.setItem(key, JSON.stringify({ version: 1, data: old, readAt: CHECKPOINT_NOW }));
  const baseline = { sourceDate: snapshotSourceDate(source, next), fetchedAt: next.fetchedAt };
  const fetcher = vi.fn(async () => next);
  const store = createSnapshotStore({ ...options, fetcher, baseline });
  expect(store.peek().fetchedAt).toBe(old.fetchedAt);
  expect((await store.load()).data.fetchedAt).toBe(next.fetchedAt); // New embedded baseline overrides fresh cache TTL.
  expect(fetcher).toHaveBeenCalledTimes(1);
  const second = createSnapshotStore({ ...options, fetcher: async () => old });
  await expect(second.load({ force: true })).rejects.toThrow('較舊');
  expect(second.peek().fetchedAt).toBe(next.fetchedAt);
  expect(JSON.parse(storage.getItem(key)).data.fetchedAt).toBe(next.fetchedAt);
});
it.each(SOURCES)('%s: source date is primary, fetchedAt only breaks ties', source => {
  const old = fixture(source, '11'), next = fixture(source, '10');
  if (source === 'quotes') next.tradeDate = '2026-10-19';
  if (source === 'news') next.articles[0].publishedAt = '2026-10-20T01:00:00Z';
  if (source === 'earthquakes') next.events[0].originTime = '2026-10-20T01:00:00Z';
  if (source === 'horoscope') next.readings.forEach(reading => { reading.date = '2026-10-21'; });
  expect(compareSnapshots(source, next, old)).toBeGreaterThan(0);
  expect(compareSnapshots(source, old, next)).toBeLessThan(0);
});
async function directories() {
  const base = resolve('.cache/test-results/latest-valid'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, 'case-')); roots.push(root);
  const project = join(root, 'new-worktree'), incoming = join(root, 'verified-checkpoint');
  await mkdir(join(project, 'public/data'), { recursive: true }); await mkdir(incoming);
  return { project, incoming };
}
async function populate(project, directory, localHour, incomingHour) {
  for (const source of SOURCES) {
    await writeFile(join(project, 'public/data', source + '.json'), JSON.stringify(fixture(source, localHour)));
    await writeFile(join(directory, source + '.json'), JSON.stringify(fixture(source, incomingHour)));
  }
}
it('a fresh worktree replaces old Git JSON with a verified newer baseline for every source', async () => {
  const { project, incoming } = await directories(); await populate(project, incoming, '10', '11');
  expect((await mergeLocalBaseline(project, incoming, CHECKPOINT_NOW)).every(item => item.accepted)).toBe(true);
  for (const source of SOURCES) expect(JSON.parse(await readFile(join(project, 'public/data', source + '.json'))).fetchedAt).toContain('T11:');
});
it('older Git/checkpoint candidates cannot replace newer local data for any source', async () => {
  const { project, incoming } = await directories(); await populate(project, incoming, '11', '10');
  expect((await mergeLocalBaseline(project, incoming, CHECKPOINT_NOW)).every(item => !item.accepted)).toBe(true);
  for (const source of SOURCES) expect(JSON.parse(await readFile(join(project, 'public/data', source + '.json'))).fetchedAt).toContain('T11:');
});
it('invalid candidates fail closed before changing any local snapshot', async () => {
  const { project, incoming } = await directories(); await populate(project, incoming, '10', '11');
  await writeFile(join(incoming, 'horoscope.json'), '{}');
  await expect(mergeLocalBaseline(project, incoming, CHECKPOINT_NOW)).rejects.toThrow();
  for (const source of SOURCES) expect(JSON.parse(await readFile(join(project, 'public/data', source + '.json'))).fetchedAt).toContain('T10:');
});

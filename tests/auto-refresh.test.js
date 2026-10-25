import { CACHE_POLICY } from '../src/services/cache-policy.js';
// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { startAutoRefresh } from '../src/services/auto-refresh.js';
import { mountNews } from '../src/pages/news.js';
import { newsFixture } from './fixtures/news.js';
afterEach(() => { vi.useRealTimers(); });
function setup(tasks) {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-20T12:00:00Z');
  const page = new EventTarget(); page.visibilityState = 'visible';
  return { page, stop: startAutoRefresh(tasks, { document: page }) };
}
it('refreshes weather at 15 minutes and AQI at 30 without background requests', async () => {
  const weather = vi.fn(), air = vi.fn();
  const { page, stop } = setup([{ interval: 900000, run: weather }, { interval: 1800000, run: air }]);
  await vi.advanceTimersByTimeAsync(900000); expect(weather).toHaveBeenCalledTimes(1); expect(air).not.toHaveBeenCalled();
  page.visibilityState = 'hidden'; await vi.advanceTimersByTimeAsync(3600000);
  expect(weather).toHaveBeenCalledTimes(1); expect(air).not.toHaveBeenCalled();
  page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0);
  expect(weather).toHaveBeenCalledTimes(2); expect(air).toHaveBeenCalledTimes(1);
  stop(); await vi.advanceTimersByTimeAsync(3600000); expect(weather).toHaveBeenCalledTimes(2);
});
it('checks only overdue active views and respects a recent manual refresh', async () => {
  let enabled = false, last = 0; const run = vi.fn();
  const { page, stop } = setup([{ interval: 300000, enabled: () => enabled, lastAt: () => last, run }]);
  await vi.advanceTimersByTimeAsync(600000); expect(run).not.toHaveBeenCalled();
  enabled = true; last = Date.now(); page.dispatchEvent(new Event('visibilitychange')); expect(run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(300000); expect(run).toHaveBeenCalledTimes(1); stop();
});
it('isolates failure and in-flight requests, and throttles failures', async () => {
  let finish; const slow = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const fail = vi.fn().mockRejectedValue(Error('offline'));
  const { stop } = setup([{ interval: 300000, run: slow }, { interval: 300000, run: fail }]);
  await vi.advanceTimersByTimeAsync(600000); expect(slow).toHaveBeenCalledTimes(1); expect(fail).toHaveBeenCalledTimes(2);
  finish(); await vi.advanceTimersByTimeAsync(0); stop();
});
it.each(['news', 'earthquakes'])('wires %s automatic reads into the existing view loader and disposes them', async name => {
  const source = await readFile(`src/pages/${name}.js`, 'utf8');
  expect(source).toContain(`interval: CACHE_POLICY.${name}, run: () => load(true)`);
  expect(CACHE_POLICY[name]).toBe(300000);
  expect(source).toContain('stopRefresh(); alive = false');
});
it('updates the mounted news view without remounting controls or writing storage', async () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-20T12:00:00Z');
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const initial = newsFixture(), next = newsFixture(); next.articles[0].title = 'New published test headline';
  const store = { peek: () => initial, load: vi.fn().mockResolvedValueOnce({ data: initial, readAt: Date.now() }).mockResolvedValue({ data: next, readAt: Date.now() + 300000 }) };
  const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
  const host = document.createElement('div'); document.body.append(host);
  const dispose = mountNews(host, { store, storage });
  try {
    await vi.advanceTimersByTimeAsync(0);
    const search = host.querySelector('input');
    await vi.advanceTimersByTimeAsync(300000);
    expect(store.load).toHaveBeenLastCalledWith({ force: true });
    expect(host.textContent).toContain('New published test headline');
    expect(host.querySelector('input')).toBe(search); expect(storage.setItem).not.toHaveBeenCalled();
    dispose(); await vi.advanceTimersByTimeAsync(300000); expect(store.load).toHaveBeenCalledTimes(2);
  } finally { dispose(); host.remove(); visibility.mockRestore(); }
});

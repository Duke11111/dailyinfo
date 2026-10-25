// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';
import { createQuoteStore } from '../src/services/quotes.js';
import { createNewsStore } from '../src/services/news.js';
import { createWeatherSession } from '../src/services/weather-session.js';
import { parseWeather } from '../src/services/weather.js';
import { DEFAULT_REGION } from '../src/services/regions.js';
import { quoteFixture } from './fixtures/quotes.js';
import { newsFixture } from './fixtures/news.js';
import { mountOverview } from '../src/pages/overview.js';
import { createHistoryService } from '../src/services/stock-history.js';
import { CACHE_POLICY } from '../src/services/cache-policy.js';
const clock = Date.parse('2026-10-25T01:00:00Z');
const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });
it('reload keeps fetchedAt and the TTL clock, but advances pageReadAt on a cache hit', async () => {
  const storage = memory(), data = quoteFixture(); let now = clock;
  const fetcher = vi.fn(async () => data);
  const options = { storage, fetcher, now: () => now, ttl: 3600000 };
  const first = await createQuoteStore(options).load();
  const raw = storage.getItem('dailyinfo.cache.quotes.v1');
  now += 60000;
  const second = await createQuoteStore(options).load(); // New page/store, same persisted cache.
  expect(second.cached).toBe(true);
  expect(second.pageReadAt).toBe(first.pageReadAt + 60000);
  expect(second.readAt).toBe(first.readAt); // Reload must not postpone revalidation.
  expect(second.data.fetchedAt).toBe(first.data.fetchedAt);
  expect(second.data.tradeDate).toBe(first.data.tradeDate);
  expect(storage.getItem('dailyinfo.cache.quotes.v1')).toBe(raw);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('renders the new page-read time independently from the snapshot on remount', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const data = quoteFixture(), storage = memory(); let now = clock;
  const empty = { peek: () => null, load: async () => ({ data: null }) };
  const store = () => createQuoteStore({ storage, fetcher: async () => data, now: () => now, ttl: 3600000 });
  const mount = () => mountOverview(host, { quotes: store(), news: empty, earthquakes: empty, now: () => now, loadCatalog: async () => null });
  let view = mount();
  await vi.waitFor(() => expect(host.querySelector('.overview-stocks .overview-source').textContent).toContain('網頁讀取：2026/10/25 09:00'));
  view.dispose(); host.replaceChildren(); now += 60000; view = mount();
  try {
    await vi.waitFor(() => expect(host.querySelector('.overview-stocks .overview-source').textContent).toContain('網頁讀取：2026/10/25 09:01'));
    expect(host.querySelector('.overview-stocks .overview-status').textContent).toContain(data.tradeDate);
    expect(host.querySelector('.overview-stocks .overview-status').textContent).toContain('超過 24 小時');
    expect(JSON.parse(storage.getItem('dailyinfo.cache.quotes.v1')).data.fetchedAt).toBe(data.fetchedAt);
  } finally { view.dispose(); }
});
it('renders a validated persistent quote before a slow background request completes', async () => {
  const storage = memory(), data = quoteFixture();
  storage.setItem('dailyinfo.cache.quotes.v1', JSON.stringify({ version: 1, data, readAt: clock - CACHE_POLICY.quotes - 1 }));
  let finish; const fetcher = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const store = createQuoteStore({ storage, fetcher, now: () => clock });
  expect(store.peek().tradeDate).toBe(data.tradeDate);
  const pending = store.load(); expect(store.load()).toBe(pending); await Promise.resolve();
  expect(store.peek().fetchedAt).toBe(data.fetchedAt); expect(fetcher).toHaveBeenCalledTimes(1);
  finish(data); await pending;
});
it('preserves corrupted cache and personal keys without pretending the cache is valid', async () => {
  const storage = memory(), key = 'dailyinfo.cache.quotes.v1'; storage.setItem(key, '{broken'); storage.setItem('dailyinfo.region.v1', 'personal');
  const store = createQuoteStore({ storage, fetcher: async () => quoteFixture(), now: () => clock });
  expect(store.peek()).toBeNull(); expect((await store.load()).persisted).toBe(false);
  expect(storage.getItem(key)).toBe('{broken'); expect(storage.getItem('dailyinfo.region.v1')).toBe('personal');
});
it('tolerates full/disabled storage while retaining the in-memory successful response', async () => {
  const storage = { getItem: () => null, setItem: () => { throw Error('quota'); } };
  const store = createNewsStore({ storage, fetcher: async () => newsFixture(), now: () => clock });
  const response = await store.load(); expect(response.persisted).toBe(false); expect(store.peek().articles.length).toBeGreaterThan(0);
});
it('refuses older content from a late response and newer cross-tab records are not overwritten', async () => {
  const storage = memory(), key = 'dailyinfo.cache.quotes.v1', data = quoteFixture();
  const newer = { ...data, fetchedAt: '2026-10-24T10:00:00Z' };
  const store = createQuoteStore({ storage, fetcher: async () => data, now: () => clock });
  storage.setItem(key, JSON.stringify({ version: 1, data: newer, readAt: clock }));
  expect(store.peek().fetchedAt).toBe(newer.fetchedAt);
  await expect(store.load({ force: true })).rejects.toThrow('較舊'); expect(JSON.parse(storage.getItem(key)).data.fetchedAt).toBe(newer.fetchedAt);
});
it('does not hold the news card behind a hanging stock request', async () => {
  const host = document.createElement('div'); document.body.append(host);
  let finish; const quotes = createQuoteStore({ fetcher: () => new Promise(r => { finish = r; }) });
  const news = createNewsStore({ fetcher: async () => newsFixture() });
  const empty = { peek: () => null, load: async () => ({ data: null }) };
  const view = mountOverview(host, { quotes, news, earthquakes: empty, loadCatalog: async () => null });
  await vi.waitFor(() => expect(host.querySelector('.overview-news').textContent).toContain(newsFixture().articles[0].title));
  expect(host.querySelector('.overview-stocks').getAttribute('aria-busy')).toBe('true');
  view.dispose(); finish(quoteFixture());
});
function weather() {
  const data = { timezone: 'Asia/Taipei', current: { time: '2026-10-24T23:45', temperature_2m: 24, relative_humidity_2m: 60, weather_code: 0 }, current_units: { temperature_2m: '°C', relative_humidity_2m: '%' }, daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%' }, daily: { time: ['2026-10-24','2026-10-25','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'], weather_code: Array(7).fill(0), temperature_2m_max: Array(7).fill(28), temperature_2m_min: Array(7).fill(20), precipitation_probability_max: Array(7).fill(10) } };
  return { ...parseWeather(data, '2026-10-24T15:50:00Z'), region: DEFAULT_REGION };
}
it('keeps yesterday weather visible with real timestamps on refresh failure, without changing region preferences', async () => {
  const storage = memory(), key = `dailyinfo.cache.weather.${DEFAULT_REGION.id}.v1`, data = weather();
  storage.setItem(key, JSON.stringify({ version: 1, data, readAt: clock - 3600000 }));
  const session = createWeatherSession({ storage, now: () => clock, fetcher: async () => { throw Error('offline'); } });
  const promise = session.load(); expect(session.state.data.fetchedAt).toBe(data.fetchedAt); expect(session.state.status).toBe('loading');
  await promise; expect(session.state.status).toBe('error'); expect(session.state.data.fetchedAt).toBe(data.fetchedAt); session.dispose();
});
it('requests independent monthly history in parallel, without synthetic missing days', async () => {
  const pending = [], fetcher = vi.fn((url) => new Promise(resolve => pending.push({ url, resolve })));
  const promise = createHistoryService({ fetchImpl: fetcher }).load('2330', '2026-10-22');
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const { url, resolve } of pending) resolve({ ok: true, json: async () => ({ stat: 'OK', fields: ['日期','收盤價'], data: [[url.includes('202610') ? '115/10/22' : '115/09/22', '100']] }) });
  expect((await promise).points.map(p => p.date)).toEqual(['2026-09-22','2026-10-22']);
});

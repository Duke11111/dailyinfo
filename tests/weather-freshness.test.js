// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { parseWeather, fetchWeather, weatherDate, assertCurrentWeather, todayForecast, WeatherError } from '../src/services/weather.js';
import { createWeatherSession, WEATHER_TTL } from '../src/services/weather-session.js';
import { DEFAULT_REGION } from '../src/services/regions.js';
import { renderWeather } from '../src/components/weather.js';
import { dayLabel } from '../src/lib/format.js';
import { startAutoRefresh } from '../src/services/auto-refresh.js';

const midnight = Date.parse('2026-10-23T16:00:00Z'); // Taiwan 10/24 00:00
function raw(start = '2026-10-24') {
  return { timezone: 'Asia/Taipei', current: { time: '2026-10-24T00:00', temperature_2m: 24, relative_humidity_2m: 60, weather_code: 0 },
    current_units: { temperature_2m: '°C', relative_humidity_2m: '%' }, daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%' },
    daily: { time: Array.from({ length: 7 }, (_, i) => new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10)), weather_code: Array(7).fill(0), temperature_2m_max: Array(7).fill(28), temperature_2m_min: Array(7).fill(20), precipitation_probability_max: [1, 23, 3, 4, 5, 6, 7] } };
}
const record = (stamp = midnight, payload = raw()) => ({ ...parseWeather(payload, new Date(stamp).toISOString()), region: DEFAULT_REGION });
it('uses Taiwan rather than UTC or the machine timezone at midnight', () => {
  expect(weatherDate(midnight - 1)).toBe('2026-10-23'); expect(weatherDate(midnight)).toBe('2026-10-24');
});
it('finds today by date when the first row is yesterday, including exact rain and temperature values', () => {
  const data = record(midnight, raw('2026-10-23'));
  expect(todayForecast(data, midnight)).toMatchObject({ date: '2026-10-24', rain: 23 });
  document.body.innerHTML = renderWeather({ status: 'success', data }, { now: midnight });
  const days = [...document.querySelectorAll('.forecast-day')];
  expect(days[0].textContent).not.toContain('今天'); expect(days[1].classList.contains('today')).toBe(true);
  expect(document.querySelector('.weather-metrics').textContent).toContain('23%');
  expect(document.querySelector('.source-note').textContent).toContain('2026-10-23 ～ 2026-10-29');
  expect(dayLabel('2026-10-23', 0, midnight)).not.toBe('今天');
});
it('never labels yesterday-only data today, and keeps the real dates and retrieval time visible', () => {
  const data = record(midnight - 60000, raw('2026-10-16')); data.time = '2026-10-23T23:45+08:00';
  expect(() => assertCurrentWeather(data, midnight)).toThrow(WeatherError);
  document.body.innerHTML = renderWeather({ status: 'success', data }, { now: midnight });
  expect(document.querySelector('[role=alert]').textContent).toContain('非當日');
  expect(document.querySelector('.forecast-day.today')).toBeNull();
  expect(document.querySelector('.source-note').textContent).toContain('2026/10/23');
});
it.each(['duplicate', 'gap', 'reversed', 'invalid-calendar'])('rejects %s daily dates', kind => {
  const data = raw();
  if (kind === 'duplicate') data.daily.time[1] = data.daily.time[0];
  if (kind === 'gap') data.daily.time[1] = '2026-10-26';
  if (kind === 'reversed') data.daily.time.reverse();
  if (kind === 'invalid-calendar') data.daily.time[0] = '2026-02-30';
  expect(() => parseWeather(data)).toThrow(WeatherError);
});
it('rejects stale current conditions even when daily forecasts include today', async () => {
  const data = raw(); data.current.time = '2026-10-23T23:45';
  await expect(fetchWeather({ now: () => midnight, fetchImpl: async () => ({ ok: true, json: async () => data }) })).rejects.toMatchObject({ kind: 'date' });
});
it('bypasses the HTTP cache, preserves real retrieval time and reads current daily dates', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => raw() }));
  const data = await fetchWeather({ now: () => midnight, fetchImpl });
  expect(fetchImpl.mock.calls[0][1].cache).toBe('no-store');
  expect(data.fetchedAt).toBe(new Date(midnight).toISOString());
});
it('invalidates a cache across midnight before its 15-minute TTL, making only one fresh request', async () => {
  let clock = midnight - 60000;
  const old = record(clock, raw('2026-10-23')); old.time = '2026-10-23T23:45+08:00';
  const fetcher = vi.fn().mockResolvedValueOnce(old).mockResolvedValue(record());
  const session = createWeatherSession({ fetcher, now: () => clock });
  await session.load(); clock = midnight; expect(session.needsRefresh).toBe(true);
  await session.load(); expect(fetcher).toHaveBeenCalledTimes(2); expect(session.state.cached).toBe(false);
  expect(todayForecast(session.state.data, clock).date).toBe('2026-10-24'); session.dispose();
});
it('refreshes expired cache and coalesces callers without rewriting timestamps', async () => {
  let clock = midnight; const fetcher = vi.fn(async () => record(clock));
  const session = createWeatherSession({ fetcher, now: () => clock });
  await session.load(); clock += WEATHER_TTL;
  const first = session.load(); expect(session.load()).toBe(first); await first;
  expect(fetcher).toHaveBeenCalledTimes(2); expect(session.state.data.fetchedAt).toBe(new Date(clock).toISOString()); session.dispose();
});
it('retries a date failure only once and succeeds if the second response matches Taiwan today', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new WeatherError('date', 'stale date')).mockResolvedValue(record());
  const session = createWeatherSession({ fetcher, now: () => midnight }); await session.load();
  expect(fetcher).toHaveBeenCalledTimes(2); expect(session.state.status).toBe('success'); session.dispose();
});
it('caps persistent date failures at two requests, caches neither, and stops on a network failure', async () => {
  const cache = new Map(), fetcher = vi.fn(async () => record(midnight, raw('2026-10-16')));
  const session = createWeatherSession({ cache, fetcher, now: () => midnight }); await session.load();
  expect(fetcher).toHaveBeenCalledTimes(2); expect(session.state.status).toBe('error'); expect(session.needsRefresh).toBe(false); expect(cache.size).toBe(0); session.dispose();
  const offline = vi.fn().mockRejectedValue(new WeatherError('network', 'offline'));
  const failed = createWeatherSession({ fetcher: offline, now: () => midnight }); await failed.load();
  expect(offline).toHaveBeenCalledTimes(1); failed.dispose();
});
it('refreshes on foreground date change despite a short age, throttles failures, and never polls hidden tabs', async () => {
  const page = new EventTarget(); page.visibilityState = 'hidden'; let clock = midnight - 60000, tick;
  const old = record(clock, raw('2026-10-23')); old.time = '2026-10-23T23:45+08:00';
  const fetcher = vi.fn().mockResolvedValueOnce(old).mockRejectedValue(new WeatherError('network', 'offline'));
  const session = createWeatherSession({ fetcher, now: () => clock }); await session.load();
  const stop = startAutoRefresh([{ interval: WEATHER_TTL, lastAt: () => session.lastAttemptAt, due: () => session.needsRefresh, run: () => session.load() }], { document: page, now: () => clock, setTimer: cb => { tick = cb; return 1; }, clearTimer: vi.fn() });
  clock = midnight; tick(); expect(fetcher).toHaveBeenCalledTimes(1);
  page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(() => expect(session.state.status).toBe('error'));
  tick(); page.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); expect(fetcher).toHaveBeenCalledTimes(2);
  stop(); session.dispose();
});

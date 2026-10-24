import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseWeather, fetchWeather, WeatherError, weatherCondition } from '../src/services/weather.js';
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-19T04:01:00Z'); });
afterEach(() => vi.useRealTimers());
function fixture() {
  return { timezone: 'Asia/Taipei', current: { time: '2026-10-19T12:00', temperature_2m: 26.3, relative_humidity_2m: 72, weather_code: 2 },
    current_units: { temperature_2m: '°C', relative_humidity_2m: '%' },
    daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%' },
    daily: { time: Array.from({ length: 7 }, (_, i) => `2026-10-${19 + i}`), weather_code: [2, 3, 61, 0, 2, 3, 1], temperature_2m_max: [28, 27, 26, 28, 29, 28, 27], temperature_2m_min: [22, 23, 22, 21, 22, 23, 22], precipitation_probability_max: [20, 30, 80, 0, 20, 10, 10] } };
}
describe('weather parsing (explicit test fixtures, never used by application)', () => {
  it('preserves actual values, Taipei effective time and seven days', () => {
    const result = parseWeather(fixture(), '2026-10-19T04:01:00Z');
    expect(result.temperature).toBe(26.3);
    expect(result.humidity).toBe(72);
    expect(result.time).toBe('2026-10-19T12:00+08:00');
    expect(result.forecast).toHaveLength(7);
    expect(result.forecast[0]).toMatchObject({ high: 28, low: 22, rain: 20 });
  });
  it('allows missing rain probability without inventing zero', () => {
    const data = fixture(); data.daily.precipitation_probability_max[0] = null;
    expect(parseWeather(data).forecast[0].rain).toBeNull();
  });
  it.each([
    (d) => { d.current.temperature_2m = null; },
    (d) => { d.current.relative_humidity_2m = 120; },
    (d) => { d.daily.time = []; },
    (d) => { d.daily.temperature_2m_max.pop(); },
    (d) => { d.daily.temperature_2m_min[0] = 100; },
    (d) => { d.daily.precipitation_probability_max[0] = -1; },
    (d) => { d.current_units.temperature_2m = '°F'; },
    (d) => { d.current.time = '<script>'; },
  ])('rejects invalid data', (mutate) => { const data = fixture(); mutate(data); expect(() => parseWeather(data)).toThrow(WeatherError); });
  it('does not label unknown WMO codes as clear', () => { expect(weatherCondition(999).label).toBe('天氣狀態未知'); });
});
describe('weather transport', () => {
  it('parses a successful request', async () => { expect((await fetchWeather({ fetchImpl: async () => ({ ok: true, json: async () => fixture() }) })).forecast).toHaveLength(7); });
  it('distinguishes HTTP failure from malformed data', async () => {
    await expect(fetchWeather({ fetchImpl: async () => ({ ok: false, status: 503 }) })).rejects.toMatchObject({ kind: 'network' });
    await expect(fetchWeather({ fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError(); } }) })).rejects.toMatchObject({ kind: 'data' });
  });
  it('handles an offline network', async () => { await expect(fetchWeather({ fetchImpl: async () => { throw new TypeError('offline'); } })).rejects.toMatchObject({ kind: 'network' }); });
  it('classifies a timeout while reading the body as a network error', async () => {
    await expect(fetchWeather({ fetchImpl: async () => ({ ok: true, json: async () => { throw new DOMException('timeout', 'AbortError'); } }) })).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('逾時') });
  });
  it('aborts a request that times out', async () => {
    vi.useFakeTimers();
    const request = fetchWeather({ timeout: 10, fetchImpl: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))) });
    const assertion = expect(request).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('逾時') });
    await vi.advanceTimersByTimeAsync(10); await assertion; vi.useRealTimers();
  });
});

import { it, expect, vi } from 'vitest';
import { buildAirQualityUrl, parseAirQuality, classifyUsAqi, fetchAirQuality, createAirQualitySession, AIR_TTL } from '../src/services/air-quality.js';
import { DEFAULT_REGION, getRegion } from '../src/services/regions.js';
import { airFixture, airCaptured } from './fixtures/air-quality.js';
const parse = data => parseAirQuality(data, { fetchedAt: airCaptured });
it('uses existing canonical coordinates, Taipei timezone and only supported fields', () => {
  const url = new URL(buildAirQualityUrl(getRegion('10005040'))); expect(url.searchParams.get('latitude')).toBe('24.711839'); expect(url.searchParams.get('current')).toBe('us_aqi,pm2_5,pm10'); expect(url.searchParams.get('forecast_hours')).toBe('24'); expect(url.searchParams.get('timezone')).toBe('Asia/Taipei'); expect(url.searchParams.get('domains')).toBe('cams_global');
  expect(() => buildAirQualityUrl({ ...DEFAULT_REGION, latitude: 999 })).toThrow('座標無效');
});
it.each([[0, 'good'], [50, 'good'], [51, 'moderate'], [100, 'moderate'], [101, 'sensitive'], [150, 'sensitive'], [151, 'unhealthy'], [200, 'unhealthy'], [201, 'very-unhealthy'], [300, 'very-unhealthy'], [301, 'hazardous'], [500, 'hazardous'], [501, 'hazardous'], [null, 'unknown'], [-1, 'unknown'], ['50', 'unknown'], [Infinity, 'unknown']])('classifies US AQI %s as %s', (value, expected) => { expect(classifyUsAqi(value).key).toBe(expected); });
it('parses real API structure, independent PM fields and precisely 24 provided hours', () => {
  const data = parse(airFixture()); expect(data).toMatchObject({ aqi: 45, pm25: 8.1, pm10: 10, time: '2026-10-20T00:00:00+08:00', fetchedAt: airCaptured, region: DEFAULT_REGION }); expect(data.points).toHaveLength(24); expect(data.points.at(-1)).toMatchObject({ time: '2026-10-20T23:00:00+08:00', aqi: 68 });
});
it('preserves zeros, missing values and partial trends without filling points', () => {
  const raw = airFixture(); raw.current.us_aqi = null; raw.current.pm2_5 = 0; delete raw.current.pm10; raw.hourly.us_aqi[2] = null; raw.hourly.time.splice(4, 1); raw.hourly.us_aqi.splice(4, 1);
  const data = parse(raw); expect(data).toMatchObject({ aqi: null, pm25: 0, pm10: null }); expect(data.points).toHaveLength(23); expect(data.points[2].aqi).toBeNull(); expect(data.warnings.join(' ')).toContain('不完整');
});
it.each([
  data => { data.current.pm2_5 = -1; }, data => { data.current.us_aqi = '45'; }, data => { data.current.pm10 = Infinity; },
  data => { data.current_units.pm10 = 'mg/m³'; }, data => { data.current_units.us_aqi = 'EuropeanAQI'; },
  data => { data.timezone = 'UTC'; }, data => { data.utc_offset_seconds = 0; }, data => { data.latitude = 30; },
  data => { data.current.time = '2026-02-30T00:00'; }, data => { data.current.time = '<img>'; }, data => { data.current.time = '2026-10-21T00:00'; },
])('rejects invalid source, main values, units, grid and dates', mutate => { const raw = airFixture(); mutate(raw); expect(() => parse(raw)).toThrow(); });
it.each([
  data => { delete data.hourly; }, data => { data.hourly.us_aqi.pop(); }, data => { data.hourly_units.us_aqi = 'other'; },
  data => { data.hourly.time[1] = data.hourly.time[0]; }, data => { data.hourly.us_aqi[1] = -1; },
])('keeps valid current data when optional trend is malformed or absent', mutate => { const raw = airFixture(); mutate(raw); const data = parse(raw); expect(data.aqi).toBe(45); expect(data.points).toEqual([]); expect(data.warnings.join(' ')).toContain('趨勢'); });
it('honors the source time window rather than including later hours', () => {
  const raw = airFixture(); raw.hourly.time.push('2026-10-21T00:00'); raw.hourly.us_aqi.push(999); const data = parse(raw); expect(data.points).toHaveLength(24); expect(data.points.some(point => point.aqi === 999)).toBe(false);
});
it('fails safely on HTTP, invalid JSON and invalid coordinates', async () => {
  await expect(fetchAirQuality({ fetchImpl: async () => ({ ok: false, status: 503 }) })).rejects.toThrow('503');
  await expect(fetchAirQuality({ fetchImpl: async () => ({ ok: true, json() { throw SyntaxError(); } }) })).rejects.toThrow('JSON');
  const fetcher = vi.fn(); await expect(fetchAirQuality({ region: null, fetchImpl: fetcher })).rejects.toThrow('座標無效'); expect(fetcher).not.toHaveBeenCalled();
});
it('times out requests and releases abort listeners', async () => {
  const fetchImpl = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
  await expect(fetchAirQuality({ fetchImpl, timeout: 5 })).rejects.toThrow('逾時');
});
it('caches for five minutes, deduplicates pending reads, and explicitly forces API refresh', async () => {
  let now = Date.parse(airCaptured); const fetcher = vi.fn(async () => ({ ...parse(airFixture()), fetchedAt: new Date(now).toISOString() }));
  const session = createAirQualitySession({ fetcher, now: () => now }); const first = session.load(DEFAULT_REGION); expect(session.load(DEFAULT_REGION)).toBe(first); await first;
  const fetchedAt = session.state.data.fetchedAt; now += 60000; await session.load(DEFAULT_REGION); expect(fetcher).toHaveBeenCalledTimes(1); expect(session.state).toMatchObject({ cached: true, readAt: now, expiresAt: Date.parse(fetchedAt) + AIR_TTL }); expect(session.state.data.fetchedAt).toBe(fetchedAt);
  await session.load(DEFAULT_REGION, { force: true }); expect(fetcher).toHaveBeenCalledTimes(2); expect(session.state.cached).toBe(false); now += AIR_TTL + 1; await session.load(DEFAULT_REGION); expect(fetcher).toHaveBeenCalledTimes(3); session.dispose();
});
it('aborts old requests and ignores old responses even if the network disregards cancellation', async () => {
  const requests = []; const fetcher = ({ region, signal }) => new Promise((resolve, reject) => requests.push({ region, signal, resolve, reject }));
  const session = createAirQualitySession({ fetcher }); const old = session.load(DEFAULT_REGION); await Promise.resolve(); const recent = session.load(getRegion('64000030')); await Promise.resolve();
  expect(requests[0].signal.aborted).toBe(true); requests[1].resolve({ ...parse(airFixture()), aqi: 88, region: getRegion('64000030') }); await recent;
  requests[0].resolve({ ...parse(airFixture()), aqi: 500 }); await old; expect(session.state.region.id).toBe('64000030'); expect(session.state.data.aqi).toBe(88); session.dispose();
});
it('preserves the same-region last good record on failure and never reuses it for another region', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(parse(airFixture())).mockRejectedValue(Error('offline')); const session = createAirQualitySession({ fetcher });
  await session.load(DEFAULT_REGION); await session.load(DEFAULT_REGION, { force: true }); expect(session.state.status).toBe('error'); expect(session.state.data.aqi).toBe(45);
  await session.load(getRegion('10005040')); expect(session.state.data).toBeNull(); expect(session.state.region.district).toBe('竹南鎮'); session.dispose();
});
it('handles invalid regions and disposed pending requests without changing UI again', async () => {
  let resolve; const onChange = vi.fn(), session = createAirQualitySession({ onChange, fetcher: () => new Promise(done => { resolve = done; }) });
  await session.load({ id: 'invalid' }); expect(session.state.status).toBe('error'); const request = session.load(DEFAULT_REGION); await Promise.resolve(); session.dispose(); const calls = onChange.mock.calls.length; resolve(parse(airFixture())); await request; expect(onChange).toHaveBeenCalledTimes(calls);
});

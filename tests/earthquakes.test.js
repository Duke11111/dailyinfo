import { it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { quakeTime, quakeNumber, quakeIntensity, quakeReportUrl, parseEarthquakeResponse, mergeEarthquakes, validateEarthquakeSnapshot, filterEarthquakes, fetchEarthquakeSnapshot, createEarthquakeStore } from '../src/services/earthquakes.js';
import { rawEarthquake, rawResponse, eqFixture, eqCaptured } from './fixtures/earthquakes.js';
afterEach(() => vi.useRealTimers());
it('parses the new IssueTime format, numeric values and grouped observed counties', () => {
  const event = parseEarthquakeResponse(rawResponse(), 'E-A0016-001', eqCaptured)[0];
  expect(event.originTime).toBe('2026-10-17T03:13:19.000Z'); expect(event.reportTime).toBe('2026-10-17T03:16:18.000Z'); expect(event.magnitude).toBe(4.6);
  expect(event.maxIntensity).toBe('2級'); expect(event.areas).toHaveLength(8); expect(event.areas.some(a => a.county === '臺南市')).toBe(false);
});
it('supports legacy space-separated times/AreaDesc and leaves absent report time unavailable', () => {
  const raw = rawEarthquake(); delete raw.IssueTime; raw.EarthquakeInfo.OriginTime = '2026-10-17 11:13:19'; raw.Intensity = { ShakingArea: [{ AreaDesc: '花蓮縣地區', AreaIntensity: '3級' }] };
  const event = parseEarthquakeResponse(rawResponse(raw), 'E-A0015-001', eqCaptured)[0]; expect(event.reportTime).toBeNull(); expect(event.areas).toEqual([{ county: '花蓮縣', intensity: '3級' }]);
});
it('treats missing optional fields as unavailable rather than zero or guessed intensity', () => {
  const raw = rawEarthquake(); delete raw.Intensity; raw.EarthquakeInfo.FocalDepth = '--'; delete raw.EarthquakeInfo.EarthquakeMagnitude;
  const event = parseEarthquakeResponse(rawResponse(raw), 'E-A0016-001', eqCaptured)[0]; expect(event.depth).toBeNull(); expect(event.magnitude).toBeNull(); expect(event.maxIntensity).toBeNull(); expect(event.areas).toEqual([]);
});
it.each(['2026-02-30 12:00:00', '2026-10-19T24:01:00+08:00', 'nonsense', 123])('rejects invalid timestamps %s', raw => { expect(() => quakeTime(raw)).toThrow(); });
it.each([['abc', 0, 10], [-1, 0, 10], [11, 0, 10], [Infinity, 0, 800], [true, -90, 90], [' ', -180, 180]])('rejects invalid quake values %s', (number, min, max) => { expect(() => quakeNumber(number, min, max)).toThrow(); });
it.each(['javascript:alert(1)', 'https://evil.test/V8/C/E/EQ/EQ115000.html', 'https://user:pw@www.cwa.gov.tw/V8/C/E/EQ/EQ115000.html', 'http://www.cwa.gov.tw/V8/C/E/EQ/EQ115000.html', 'https://www.cwa.gov.tw/V8/C/E/EQ/EQ115000.html?Authorization=test'])('rejects unsafe report URLs', raw => { expect(() => quakeReportUrl(raw)).toThrow(); });
it('preserves official strong/weak intensity scales and validates them', () => { expect(quakeIntensity('5弱')).toBe('5弱'); expect(quakeIntensity('6強')).toBe('6強'); expect(() => quakeIntensity('9級')).toThrow(); });
it('rejects malformed source records, future events and invalid coordinates', () => {
  expect(() => parseEarthquakeResponse({ success: false }, 'E-A0015-001', eqCaptured)).toThrow();
  const raw = rawEarthquake(); raw.EarthquakeInfo.Epicenter.EpicenterLatitude = 91; expect(() => parseEarthquakeResponse(rawResponse(raw), 'E-A0015-001', eqCaptured)).toThrow();
  raw.EarthquakeInfo.Epicenter.EpicenterLatitude = 24; raw.EarthquakeInfo.OriginTime = '2027-01-01T00:00:00+08:00'; expect(() => parseEarthquakeResponse(rawResponse(raw), 'E-A0015-001', eqCaptured)).toThrow();
});
it('deduplicates both report types, prefers the newer issue and preserves separate events', () => {
  const local = parseEarthquakeResponse(rawResponse(), 'E-A0016-001', eqCaptured)[0];
  const significant = parseEarthquakeResponse(rawResponse(rawEarthquake({ IssueTime: '2026-10-17T11:17:00+08:00' })), 'E-A0015-001', eqCaptured)[0];
  const merged = mergeEarthquakes([[local], [significant], [eqFixture().events[1]]]); expect(merged).toHaveLength(2); expect(merged[0].reports).toHaveLength(2); expect(merged[0].reportTime).toBe(significant.reportTime);
});
it('validates normalized snapshots, drops extra fields and rejects duplicate/mismatched identity', () => {
  const data = eqFixture(); data.Authorization = 'test-only'; expect(validateEarthquakeSnapshot(data)).not.toHaveProperty('Authorization');
  expect(() => validateEarthquakeSnapshot({ ...data, events: [data.events[0], data.events[0]] })).toThrow();
  data.events[0].id = 'wrong'; expect(() => validateEarthquakeSnapshot(data)).toThrow();
});
it('validates the real public snapshot with two official datasets and no credentials', () => {
  const raw = readFileSync(new URL('../public/data/earthquakes.json', import.meta.url), 'utf8'); const snapshot = validateEarthquakeSnapshot(JSON.parse(raw));
  expect(snapshot.events.length).toBeGreaterThan(0); expect(snapshot.feeds).toHaveLength(2); expect(raw).not.toMatch(/Authorization|CWA-[a-z0-9-]{20,}/i);
});
it('combines location/county, magnitude, Taipei date and report-type filters', () => {
  const data = eqFixture().events;
  expect(filterEarthquakes(data, { query: '宜蘭', minMagnitude: '4.5', maxMagnitude: '4.7', startDate: '2026-10-17', endDate: '2026-10-17', type: 'E-A0016-001' })).toHaveLength(1);
  expect(filterEarthquakes(data, { query: '台北' })).toHaveLength(1); expect(filterEarthquakes(data, { query: '不存在' })).toEqual([]);
  expect(filterEarthquakes(data, { maxMagnitude: '4.4' })[0].location).toContain('花蓮'); expect(data[0].location).toContain('宜蘭');
});
it.each([{ minMagnitude: '6', maxMagnitude: '3' }, { minMagnitude: 'abc' }, { startDate: '2026-10-20', endDate: '2026-10-01' }, { startDate: '2026-02-30' }, { type: 'invalid' }])('rejects invalid simultaneous filters', filter => { expect(() => filterEarthquakes(eqFixture().events, filter)).toThrow(); });
it('supports a valid empty snapshot', () => { expect(validateEarthquakeSnapshot({ ...eqFixture(), events: [] }).events).toEqual([]); });
it.each(['HTTP', 'JSON', 'offline', 'invalid'])('handles %s snapshot failures', async mode => {
  const fetchImpl = async () => { if (mode === 'offline') throw Error('offline'); return { ok: mode !== 'HTTP', status: 503, json: async () => { if (mode === 'JSON') throw Error('JSON'); return {}; } }; };
  await expect(fetchEarthquakeSnapshot({ fetchImpl })).rejects.toThrow();
});
it('aborts slow snapshot requests', async () => {
  vi.useFakeTimers(); const request = fetchEarthquakeSnapshot({ timeout: 50, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error(), { name: 'AbortError' })))) });
  const assertion = expect(request).rejects.toThrow('逾時'); await vi.advanceTimersByTimeAsync(51); await assertion;
});
it('shares requests, caches, limits refresh and preserves valid data after failure/rollback', async () => {
  let clock = 100000; const fetcher = vi.fn().mockResolvedValueOnce(eqFixture()).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({ ...eqFixture(), fetchedAt: '2026-10-18T00:00:00.000Z' });
  const store = createEarthquakeStore({ fetcher, now: () => clock }); await Promise.all([store.load(), store.load()]); expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await store.load({ force: true })).cached).toBe(true); clock += 10001; await expect(store.load({ force: true })).rejects.toThrow('offline'); expect(store.peek().events).toHaveLength(2);
  clock += 10001; await expect(store.load({ force: true })).rejects.toThrow('較舊'); expect(store.peek().fetchedAt).toBe(eqCaptured);
});

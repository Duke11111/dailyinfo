import { it, expect, vi } from 'vitest';
import { createLiveHoroscopeStore } from '../src/services/horoscope-live.js';
import { SIGNS, HOROSCOPE_SOURCE, readingUrl } from '../src/services/horoscope.js';
const time = Date.parse('2026-10-24T01:00:00Z');
const snapshot = (date = '2026-10-23') => ({ data: { version: 1, source: HOROSCOPE_SOURCE, language: 'en', fetchedAt: '2026-10-23T01:00:00Z', readings: SIGNS.map(s => ({ sign: s.code, date, text: `Test only ${s.code}` })) } });
const raw = (sign = 'aries', date = '2026-10-24') => ({ data: { sign, date, period: 'daily', horoscope: 'Test text <img src=x onerror=alert(1)> kept as plain text' } });
const response = data => ({ ok: true, type: 'cors', headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }), text: async () => JSON.stringify(data) });
const setup = (fetcher = vi.fn(async () => response(raw())), options = {}) => ({ fetcher, store: createLiveHoroscopeStore({ now: () => time, baseline: { load: async () => snapshot() }, fetchImpl: fetcher, ...options }) });
it.each(SIGNS.map(s => s.code))('accepts validated Taiwan-today %s using the original official source', async sign => {
  const { store, fetcher } = setup(vi.fn(async () => response(raw(sign))));
  const result = await store.load(sign);
  expect(result).toMatchObject({ mode: 'live', source: HOROSCOPE_SOURCE, reading: { sign, date: '2026-10-24' }, fetchedAt: new Date(time).toISOString() });
  expect(fetcher).toHaveBeenCalledWith(readingUrl(sign), expect.objectContaining({ mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store' }));
  expect(result.reading.text).toContain('<img'); // Text is never executed or translated here.
});
it('prioritizes the live response even when the baseline already provides today', async () => {
  const { store, fetcher } = setup(undefined, { baseline: { load: async () => snapshot('2026-10-24') } });
  expect((await store.load('aries')).mode).toBe('live'); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not wait for a slow baseline before returning a validated live response', async () => {
  let finish;
  const { store, fetcher } = setup(undefined, { baseline: { load: () => new Promise(resolve => { finish = resolve; }) } });
  expect((await store.load('aries')).mode).toBe('live'); expect(fetcher).toHaveBeenCalledTimes(1);
  finish(snapshot());
});
it('coalesces concurrent same-sign requests, caches briefly, and isolates other signs', async () => {
  const { store, fetcher } = setup(vi.fn(async url => response(raw(new URL(url).searchParams.get('sign')))));
  const first = store.load('aries'); expect(store.load('aries')).toBe(first); await first; await store.load('aries'); await store.load('leo');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('reports CORS/network failure safely, preserves yesterday baseline and throttles failures', async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError('private transport detail'));
  const { store } = setup(fetcher); const result = await store.load('aries'); await store.load('aries');
  expect(result).toMatchObject({ mode: 'snapshot', problem: 'cors_or_network_error', reading: { date: '2026-10-23' } });
  expect(JSON.stringify(result)).not.toContain('private transport'); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['yesterday', 'future', 'wrong-sign', 'wrong-period', 'missing-text', 'malformed-json', 'opaque', 'html', 'http', 'oversize'])('rejects %s and falls back without modifying baseline', async kind => {
  const data = raw(); let reply;
  if (kind === 'yesterday') data.data.date = '2026-10-23';
  if (kind === 'future') data.data.date = '2026-10-25';
  if (kind === 'wrong-sign') data.data.sign = 'leo';
  if (kind === 'wrong-period') data.data.period = 'weekly';
  if (kind === 'missing-text') data.data.horoscope = '';
  reply = response(data);
  if (kind === 'malformed-json') reply.text = async () => '<html>';
  if (kind === 'opaque') reply.type = 'opaque';
  if (kind === 'html') reply.headers = new Headers({ 'content-type': 'text/html' });
  if (kind === 'http') reply.ok = false;
  if (kind === 'oversize') reply.text = async () => 'x'.repeat(65537);
  const baseline = snapshot(), before = JSON.stringify(baseline);
  const { store } = setup(vi.fn(async () => reply), { baseline: { load: async () => baseline } });
  expect((await store.load('aries')).mode).toBe('snapshot'); expect(JSON.stringify(baseline)).toBe(before);
});
it('does not reuse yesterday live cache after Taiwan midnight and rejects an in-flight date rollover', async () => {
  let clock = Date.parse('2026-10-24T15:59:00Z'); const fetcher = vi.fn(async () => response(raw()));
  const { store } = setup(fetcher, { now: () => clock }); await store.load('aries'); clock += 120000;
  const result = await store.load('aries'); expect(result.mode).toBe('snapshot'); expect(result.reading.date).toBe('2026-10-23'); expect(fetcher).toHaveBeenCalledTimes(2);
  clock = Date.parse('2026-10-24T15:59:00Z');
  const rolling = setup(vi.fn(async () => { clock += 120000; return response(raw()); }), { now: () => clock }).store;
  expect((await rolling.load('aries')).problem).toBe('live_date_mismatch');
});
it('fails closed without a baseline when the API fails, and rejects invalid signs before any read', async () => {
  const baseline = { load: vi.fn().mockRejectedValue(Error('offline')) }, fetcher = vi.fn().mockRejectedValue(Error('private'));
  const { store } = setup(fetcher, { baseline });
  await expect(store.load('../invalid')).rejects.toThrow('invalid_sign'); expect(baseline.load).not.toHaveBeenCalled();
  await expect(store.load('aries')).rejects.toThrow('cors_or_network_error'); expect(fetcher).toHaveBeenCalledTimes(1);
});

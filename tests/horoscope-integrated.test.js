// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountHoroscope } from '../src/components/horoscope.js';
import { createLiveHoroscopeStore, HOROSCOPE_LIVE_TTL } from '../src/services/horoscope-live.js';
import { HOROSCOPE_SOURCE, HOROSCOPE_KEY, SIGNS, taipeiDate } from '../src/services/horoscope.js';

const now = Date.parse('2026-10-24T01:00:00Z');
const snapshot = () => ({ data: { version: 1, source: HOROSCOPE_SOURCE, language: 'en', fetchedAt: '2026-10-23T01:00:00Z', readings: SIGNS.map(s => ({ sign: s.code, date: '2026-10-23', text: `Synthetic baseline ${s.code}` })) } });
const raw = (sign = 'aries', date = taipeiDate()) => ({ data: { sign, date, period: 'daily', horoscope: `Synthetic live ${sign} <img src=x onerror=alert(1)>` } });
const response = data => ({ ok: true, status: 200, type: 'cors', headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(data) });
const baseline = () => ({ load: vi.fn(async () => snapshot()) });
let host, dispose, hidden;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); hidden = false;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
  document.body.innerHTML = '<div id="host"></div>'; host = document.querySelector('#host'); localStorage.clear();
});
afterEach(async () => { dispose?.(); await Promise.resolve(); vi.useRealTimers(); vi.restoreAllMocks(); });
function boot(fetcher = vi.fn(async url => response(raw(new URL(url).searchParams.get('sign')))), options = {}) {
  const store = options.store ?? createLiveHoroscopeStore({ baseline: baseline(), fetchImpl: fetcher, ...options });
  dispose = mountHoroscope(host, { store }); return { store, fetcher };
}
const settled = () => vi.waitFor(() => expect(host.querySelector('.horoscope-card').getAttribute('aria-busy')).toBe('false'));
const choose = sign => { const select = host.querySelector('select'); select.focus(); select.value = sign; select.dispatchEvent(new Event('change')); };
const click = label => [...host.querySelectorAll('button')].find(b => b.textContent === label).click();

it('starts with only the saved sign and renders safe original text, source date and real acquisition time', async () => {
  localStorage.setItem(HOROSCOPE_KEY, JSON.stringify({ version: 1, defaultSign: 'leo' })); localStorage.setItem('preserve', 'untouched');
  const before = { ...localStorage }, { fetcher } = boot(); await settled();
  expect(fetcher).toHaveBeenCalledTimes(1); expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('sign')).toBe('leo');
  expect(host.textContent).toContain('今日運勢 · 來源日期 2026-10-24'); expect(host.textContent).toContain('即時 API 取得');
  expect(host.querySelector('img, script')).toBeNull(); expect(host.querySelector('.horoscope-reading').textContent).toContain('<img');
  expect(host.querySelector('a').textContent).toBe('Powered by FreeHoroscopeAPI'); expect(host.querySelector('.horoscope-reading').lang).toBe('en');
  click('展開完整運勢'); expect(host.querySelector('[aria-expanded]').getAttribute('aria-expanded')).toBe('true');
  click('收合運勢'); expect({ ...localStorage }).toEqual(before);
});
it('switches all twelve signs on demand, preserves select focus and default preference, and caches returns', async () => {
  localStorage.setItem(HOROSCOPE_KEY, JSON.stringify({ version: 1, defaultSign: 'aries' }));
  const { fetcher } = boot(); await settled();
  for (const { code } of SIGNS.slice(1)) {
    choose(code); await settled(); expect(host.querySelector('.horoscope-reading').textContent).toContain(`live ${code}`);
    expect(document.activeElement).toBe(host.querySelector('select'));
  }
  expect(fetcher).toHaveBeenCalledTimes(12); expect(JSON.parse(localStorage.getItem(HOROSCOPE_KEY)).defaultSign).toBe('aries');
  click('回到我的星座'); await settled(); expect(fetcher).toHaveBeenCalledTimes(12); expect(host.querySelector('.horoscope-reading').id).toBe('horoscope-reading-aries');
});
it('coalesces repeated clicks and resumes a fresh cache across page remounts, expiring after five minutes', async () => {
  const { fetcher, store } = boot(); await settled();
  click('重新取得運勢'); click('重新取得運勢'); await settled(); expect(fetcher).toHaveBeenCalledTimes(1);
  dispose(); boot(fetcher, { store }); await settled(); expect(fetcher).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + HOROSCOPE_LIVE_TTL); click('重新取得運勢'); await settled(); expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(['cors', 'http', '429', 'yesterday', 'future', 'invalid-date', 'malformed'])('uses safe dated fallback for %s, preserving warnings outside the collapsed text', async kind => {
  const fetcher = vi.fn(async () => {
    if (kind === 'cors') throw new TypeError('private network detail');
    const data = raw(); if (kind === 'yesterday') data.data.date = '2026-10-23'; if (kind === 'future') data.data.date = '2026-10-25'; if (kind === 'invalid-date') data.data.date = '2026-02-30';
    const reply = response(data); if (kind === 'http' || kind === '429') { reply.ok = false; reply.status = kind === '429' ? 429 : 503; }
    if (kind === 'malformed') reply.text = async () => '<html>private</html>'; return reply;
  });
  boot(fetcher); await settled(); const warning = host.querySelector('[role=status] > strong');
  expect(warning.textContent).toContain('非今日資料'); expect(warning.textContent).toContain('來源日期 2026-10-23');
  expect(host.textContent).toContain('快照擷取'); expect(host.querySelector('[role=alert]')).not.toBeNull(); expect(host.textContent).not.toContain('private');
  click('展開完整運勢'); click('收合運勢'); expect(warning.isConnected).toBe(true);
  click('重新取得運勢'); await settled(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('times out once, shows fallback, and applies failure cooldown without autonomous retries', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const fetcher = vi.fn((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))));
  boot(fetcher, { timeout: 100 }); await vi.advanceTimersByTimeAsync(101);
  expect(host.textContent).toContain('逾時'); expect(host.textContent).toContain('非今日資料'); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10 * 60000); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('cancels obsolete signs and prevents a late response from overwriting the current sign', async () => {
  let finish;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockImplementation(async url => response(raw(new URL(url).searchParams.get('sign'))));
  boot(fetcher); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const oldSignal = fetcher.mock.calls[0][1].signal; choose('leo'); await settled();
  expect(oldSignal.aborted).toBe(true); expect(host.querySelector('.horoscope-reading').textContent).toContain('live leo');
  finish(response(raw('aries'))); await Promise.resolve(); await Promise.resolve(); expect(host.querySelector('.horoscope-reading').textContent).not.toContain('live aries');
});
it('aborts on leaving, never updates a disposed card and does not turn cancellation into a failure cooldown', async () => {
  let finish; const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockImplementation(async () => response(raw()));
  const { store } = boot(fetcher); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const before = host.textContent, signal = fetcher.mock.calls[0][1].signal; dispose();
  expect(signal.aborted).toBe(true); finish(response(raw())); await Promise.resolve(); await Promise.resolve(); expect(host.textContent).toBe(before);
  boot(fetcher, { store }); await settled(); expect(fetcher).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('即時 API 取得');
});
it('keeps shared transport alive for another active consumer while cancelling only the departing one', async () => {
  let finish; const fetcher = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const store = createLiveHoroscopeStore({ baseline: baseline(), fetchImpl: fetcher });
  const first = new AbortController(), second = new AbortController();
  const a = store.load('aries', { signal: first.signal }), b = store.load('aries', { signal: second.signal });
  const rejection = expect(a).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function')); first.abort(); await rejection;
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false); finish(response(raw())); expect((await b).mode).toBe('live'); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('updates at Taiwan midnight while visible, despite an unexpired five-minute cache', async () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-24T15:59:59Z'); const { fetcher } = boot(); await vi.advanceTimersByTimeAsync(0);
  expect(host.textContent).toContain('來源日期 2026-10-24'); await vi.advanceTimersByTimeAsync(1002);
  expect(host.textContent).toContain('今日運勢 · 來源日期 2026-10-25'); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('skips hidden midnight requests, checks freshness on foreground and cleans listeners/timers on leaving', async () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-24T15:59:59Z'); const { fetcher } = boot(); await vi.advanceTimersByTimeAsync(0);
  hidden = true; await vi.advanceTimersByTimeAsync(1002); expect(fetcher).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('非今日資料');
  hidden = false; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0);
  expect(host.textContent).toContain('來源日期 2026-10-25'); expect(fetcher).toHaveBeenCalledTimes(2);
  dispose(); await vi.advanceTimersByTimeAsync(86400001); document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not fetch again on foreground until cache/cooldown expires, and makes no requests if mounted hidden', async () => {
  hidden = true; const { fetcher } = boot(); await Promise.resolve(); expect(fetcher).not.toHaveBeenCalled();
  hidden = false; document.dispatchEvent(new Event('visibilitychange')); await settled();
  document.dispatchEvent(new Event('visibilitychange')); await settled(); expect(fetcher).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + HOROSCOPE_LIVE_TTL); document.dispatchEvent(new Event('visibilitychange')); await settled(); expect(fetcher).toHaveBeenCalledTimes(2);
});

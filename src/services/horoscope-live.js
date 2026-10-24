// Browser-only current-sign reads. Published snapshots and their updater stay independent.
import { horoscopeStore, HOROSCOPE_SOURCE, parseReading, readingUrl, taipeiDate, validSign, validateHoroscope } from './horoscope.js';

export const HOROSCOPE_LIVE_TTL = 5 * 60000;
const cancelled = () => new DOMException('Request cancelled', 'AbortError');
export function createLiveHoroscopeStore({ baseline = horoscopeStore, fetchImpl = (...args) => globalThis.fetch(...args), now = Date.now, timeout = 12000 } = {}) {
  const cache = new Map(), failures = new Map(), pending = new Map();
  const interval = HOROSCOPE_LIVE_TTL;
  function subscribe(entry, key, signal) {
    if (!signal) { entry.uncancellable = true; return entry.promise; }
    return new Promise((resolve, reject) => {
      const consumer = {}; entry.consumers.add(consumer);
      const cleanup = () => { entry.consumers.delete(consumer); signal.removeEventListener('abort', abort); };
      const abort = () => {
        cleanup(); reject(cancelled());
        if (!entry.consumers.size && !entry.uncancellable) {
          if (pending.get(key) === entry) pending.delete(key);
          entry.controller.abort();
        }
      };
      signal.addEventListener('abort', abort, { once: true });
      entry.promise.then(result => { cleanup(); resolve(result); }, error => { cleanup(); reject(error); });
      if (signal.aborted) abort();
    });
  }
  return {
    load(sign, { signal } = {}) {
      if (!validSign(sign)) return Promise.reject(Error('invalid_sign'));
      if (signal?.aborted) return Promise.reject(cancelled());
      const today = taipeiDate(now()), key = `${today}/${sign}`;
      if (pending.has(key)) return subscribe(pending.get(key), key, signal);
      const entry = { controller: new AbortController(), consumers: new Set(), uncancellable: false };
      const job = (async () => {
        const saved = cache.get(sign);
        if (saved?.reading.date === today && now() - Date.parse(saved.fetchedAt) < interval) return { ...saved, readAt: now() };
        // Fetch the baseline independently: a slow static JSON must not delay the live API.
        const snapshotJob = (async () => {
          try {
            const result = await baseline.load(), data = validateHoroscope(result.data);
            const reading = data.readings.find(item => item.sign === sign);
            if (reading.date <= today && Date.parse(data.fetchedAt) <= now() + 300000) {
              return { reading, fetchedAt: data.fetchedAt, readAt: now(), source: HOROSCOPE_SOURCE, mode: 'snapshot', problem: '' };
            }
          } catch { /* A live response is validated independently of baseline availability. */ }
        })();
        if (entry.controller.signal.aborted) throw cancelled();
        const fallback = async code => {
          const snapshot = await snapshotJob;
          if (entry.controller.signal.aborted && !timedOut) throw cancelled();
          if (!snapshot || snapshot.reading.date > taipeiDate(now())) throw Error(code);
          return { ...snapshot, readAt: now(), problem: code };
        };
        let timedOut = false;
        const failure = failures.get(sign);
        if (failure?.date === today && now() < failure.retryAt) return fallback(failure.code);
        let code = 'cors_or_network_error';
        const timer = setTimeout(() => { timedOut = true; entry.controller.abort(); }, timeout);
        try {
          const response = await fetchImpl(readingUrl(sign), { mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: entry.controller.signal });
          if (!response.ok) { code = response.status === 429 ? 'live_rate_limited' : 'live_http_error'; throw Error(); }
          code = 'live_data_invalid';
          if (response.type !== 'cors' || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw Error();
          const text = await response.text();
          if (text.length > 65536) throw Error();
          const reading = parseReading(JSON.parse(text), sign);
          if (entry.controller.signal.aborted) throw cancelled();
          code = 'live_date_mismatch';
          if (taipeiDate(now()) !== today || reading.date !== today) throw Error();
          const result = { reading, fetchedAt: new Date(now()).toISOString(), readAt: now(), source: HOROSCOPE_SOURCE, mode: 'live', problem: '' };
          cache.set(sign, result); failures.delete(sign); return result;
        } catch {
          if (entry.controller.signal.aborted && !timedOut) throw cancelled();
          if (timedOut) code = 'live_timeout';
          failures.set(sign, { date: today, retryAt: now() + interval, code });
          return fallback(code);
        } finally { clearTimeout(timer); }
      })();
      entry.promise = job; pending.set(key, entry);
      job.finally(() => { if (pending.get(key) === entry) pending.delete(key); }).catch(() => {});
      return subscribe(entry, key, signal);
    },
  };
}
export const liveHoroscopeStore = createLiveHoroscopeStore();

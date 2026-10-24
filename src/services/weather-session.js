import { DEFAULT_REGION, validateCoordinates } from './regions.js';
import { fetchWeather, WeatherError, assertCurrentWeather } from './weather.js';

export const WEATHER_TTL = 15 * 60000;
// Each view owns its state/cancellation; only successful regional records are shared.
export function createWeatherSession({ region = DEFAULT_REGION, fetcher = fetchWeather, onChange = () => {}, now = Date.now, cache = new Map(), ttl = WEATHER_TTL } = {}) {
  let state = { status: 'loading', region, data: null, error: null, cached: false };
  let active = null, generation = 0, disposed = false, lastAttemptAt = 0;
  const publish = next => { state = next; onChange(state); };
  const usable = data => { try { assertCurrentWeather(data, now()); return Date.parse(data.fetchedAt) + ttl > now(); } catch { return false; } };
  return {
    get state() { return state; },
    get lastAttemptAt() { return Math.max(lastAttemptAt, Date.parse(state.data?.fetchedAt) || 0); },
    get needsRefresh() { return state.status === 'success' && !usable(state.data); },
    load(target = state.region, { force = false } = {}) {
      if (disposed) return Promise.resolve();
      if (active?.id === target?.id && validateCoordinates(target)) return active.promise;
      const token = ++generation; active?.controller.abort(); active = null;
      if (!validateCoordinates(target)) {
        publish({ ...state, status: 'error', data: null, error: new WeatherError('location', '地區或座標無效，請重新選擇行政區。') });
        return Promise.resolve();
      }
      const saved = cache.get(target.id);
      if (!force && saved && now() < saved.expiresAt && usable(saved.data)) {
        publish({ status: 'success', region: target, data: saved.data, error: null, cached: true });
        return Promise.resolve();
      }
      const controller = new AbortController(); lastAttemptAt = now();
      publish({ status: 'loading', region: target, data: null, error: null, cached: false });
      const promise = Promise.resolve().then(async () => {
        // One bounded refresh for a stale API date; network/schema failures never loop.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const data = await fetcher({ region: target, signal: controller.signal });
            if (disposed || token !== generation) return;
            assertCurrentWeather(data, now()); return data;
          } catch (error) { if (disposed || token !== generation || controller.signal.aborted || error.kind !== 'date' || attempt === 1) throw error; }
        }
      }).then(data => {
        if (disposed || token !== generation) return;
        if (data.region?.id !== target.id) throw new WeatherError('data', '天氣回應地區不符，請重新查詢。');
        cache.delete(target.id); cache.set(target.id, { data, expiresAt: Date.parse(data.fetchedAt) + ttl });
        if (cache.size > 12) cache.delete(cache.keys().next().value);
        publish({ status: 'success', region: target, data, error: null, cached: false });
      }).catch(error => {
        if (!disposed && token === generation) publish({ ...state, status: 'error', data: null, error });
      }).finally(() => { if (token === generation) active = null; });
      active = { id: target.id, controller, promise }; return promise;
    },
    dispose() { disposed = true; generation++; active?.controller.abort(); active = null; },
  };
}

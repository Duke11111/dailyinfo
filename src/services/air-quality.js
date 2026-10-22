import { DEFAULT_REGION, validateCoordinates } from './regions.js';

export const AIR_SOURCE = 'https://open-meteo.com/en/docs/air-quality-api';
export const AIR_TTL = 300000;
export class AirQualityError extends Error {
  constructor(kind, message) { super(message); this.name = 'AirQualityError'; this.kind = kind; }
}
export function buildAirQualityUrl(region = DEFAULT_REGION) {
  if (!validateCoordinates(region)) throw new AirQualityError('location', '空氣品質地區或座標無效，請重新選擇。');
  return 'https://air-quality-api.open-meteo.com/v1/air-quality?' + new URLSearchParams({ latitude: String(region.latitude), longitude: String(region.longitude), current: 'us_aqi,pm2_5,pm10', hourly: 'us_aqi', forecast_hours: '24', timezone: 'Asia/Taipei', domains: 'cams_global' });
}
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const levels = [
  [50, 'good', '良好', '空氣品質良好，污染風險較低。'],
  [100, 'moderate', '普通', '空氣品質可接受，部分特別敏感者仍可能受影響。'],
  [150, 'sensitive', '對敏感族群不健康', '敏感族群可能受到影響。'],
  [200, 'unhealthy', '不健康', '一般民眾也可能受到影響。'],
  [300, 'very-unhealthy', '非常不健康', '所有人的健康風險均增加。'],
  [Infinity, 'hazardous', '危害', '所有人都可能受到較嚴重影響。'],
];
export function classifyUsAqi(value) {
  if (!numeric(value)) return { key: 'unknown', label: '未提供', description: '來源未提供有效美國 AQI。' };
  const [, key, label, description] = levels.find(([max]) => value <= max); return { key, label, description };
}
function isoTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new AirQualityError('data', '空氣品質時間格式異常。');
  const iso = `${value}:00+08:00`, stamp = Date.parse(iso);
  if (!Number.isFinite(stamp) || new Date(stamp + 28800000).toISOString().slice(0, 16) !== value) throw new AirQualityError('data', '空氣品質日期無效。');
  return iso;
}
function number(value) {
  if (value === null || value === undefined) return null;
  if (!numeric(value)) throw new AirQualityError('data', '空氣品質數值格式異常。');
  return value;
}
export function parseAirQuality(raw, { region = DEFAULT_REGION, fetchedAt = new Date().toISOString() } = {}) {
  buildAirQualityUrl(region);
  if (!raw || raw.timezone !== 'Asia/Taipei' || raw.utc_offset_seconds !== 28800 || !raw.current || !Number.isFinite(Date.parse(fetchedAt))
    || !Number.isFinite(raw.latitude) || !Number.isFinite(raw.longitude) || Math.abs(raw.latitude - region.latitude) > .6 || Math.abs(raw.longitude - region.longitude) > .6) throw new AirQualityError('data', '空氣品質來源、時區或網格座標異常。');
  const time = isoTime(raw.current.time), warnings = [];
  if (Date.parse(time) > Date.parse(fetchedAt) + 3600000) throw new AirQualityError('data', '空氣品質有效時間異常。');
  const fields = [['us_aqi', 'USAQI'], ['pm2_5', 'μg/m³'], ['pm10', 'μg/m³']];
  const values = fields.map(([key, unit]) => {
    const value = number(raw.current[key]);
    if (value !== null && raw.current_units?.[key] !== unit) throw new AirQualityError('data', '空氣品質單位異常。');
    if (value === null) warnings.push(`${key} 未提供`); return value;
  });
  let points = [];
  try {
    const h = raw.hourly;
    if (!h || raw.hourly_units?.us_aqi !== 'USAQI' || !Array.isArray(h.time) || !Array.isArray(h.us_aqi) || h.time.length !== h.us_aqi.length || h.time.length > 168) throw Error();
    let previous = -Infinity;
    const start = Math.floor(Date.parse(time) / 3600000) * 3600000;
    points = h.time.map((value, index) => {
      const date = isoTime(value), timestamp = Date.parse(date);
      if (timestamp <= previous || timestamp % 3600000 !== 0) throw Error(); previous = timestamp;
      return { time: date, aqi: number(h.us_aqi[index]) };
    }).filter(point => Date.parse(point.time) >= start && Date.parse(point.time) < start + 24 * 3600000);
    if (points.length < 24 || points.some(point => point.aqi === null)) warnings.push('24 小時預報資料不完整；未補值，缺值處斷線。');
  } catch { points = []; warnings.push('來源未提供可用的逐時趨勢；目前數值仍可查看。'); }
  return { region, aqi: values[0], pm25: values[1], pm10: values[2], time, fetchedAt, points, warnings, grid: { latitude: raw.latitude, longitude: raw.longitude } };
}
export async function fetchAirQuality({ region = DEFAULT_REGION, signal, fetchImpl = (...args) => fetch(...args), timeout = 12000, now = Date.now } = {}) {
  const url = buildAirQualityUrl(region), controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new AirQualityError('network', `空氣品質服務請求失敗（HTTP ${response.status}）。`);
    let raw;
    try { raw = await response.json(); } catch (error) { if (error.name === 'AbortError') throw error; throw new AirQualityError('data', '空氣品質回應不是有效 JSON。'); }
    return parseAirQuality(raw, { region, fetchedAt: new Date(now()).toISOString() });
  } catch (error) {
    if (error instanceof AirQualityError) throw error;
    throw new AirQualityError('network', error.name === 'AbortError' ? '空氣品質請求逾時或已取消，請重試。' : '無法連線至空氣品質服務，天氣預報不受影響。');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

// Independent view state; callers may share successful regional cache records.
export function createAirQualitySession({ fetcher = fetchAirQuality, onChange = () => {}, now = Date.now, ttl = AIR_TTL, cache = new Map(), initialRegion = DEFAULT_REGION } = {}) {
  let generation = 0, active = null, disposed = false;
  let state = { status: 'idle', region: validateCoordinates(initialRegion) ? initialRegion : DEFAULT_REGION, data: null, error: null, cached: false, readAt: null, expiresAt: null };
  const publish = next => { state = next; onChange(state); };
  return {
    get state() { return state; },
    load(region, { force = false } = {}) {
      if (disposed) return Promise.resolve();
      if (active?.id === region?.id && validateCoordinates(region)) return active.promise;
      const token = ++generation; active?.controller.abort(); active = null;
      try { buildAirQualityUrl(region); }
      catch (error) { publish({ status: 'error', region, data: null, error, readAt: null, expiresAt: null, cached: false }); return Promise.resolve(); }
      const saved = cache.get(region.id);
      if (!force && saved && now() < saved.expiresAt) {
        cache.delete(region.id); cache.set(region.id, saved);
        publish({ status: 'success', region, ...saved, error: null, readAt: now(), cached: true }); return Promise.resolve();
      }
      const controller = new AbortController();
      publish({ status: 'loading', region, data: saved?.data ?? null, expiresAt: saved?.expiresAt ?? null, readAt: saved?.readAt ?? null, error: null, cached: Boolean(saved) });
      const promise = Promise.resolve().then(() => fetcher({ region, signal: controller.signal, now })).then(data => {
        if (disposed || token !== generation) return;
        const record = { data, readAt: now(), expiresAt: Date.parse(data.fetchedAt) + ttl };
        cache.delete(region.id); cache.set(region.id, record); if (cache.size > 12) cache.delete(cache.keys().next().value);
        publish({ status: 'success', region, ...record, error: null, cached: false });
      }).catch(error => {
        if (!disposed && token === generation) publish({ ...state, status: 'error', error });
      }).finally(() => { if (token === generation) active = null; });
      active = { id: region.id, controller, promise }; return promise;
    },
    dispose() { disposed = true; generation++; active?.controller.abort(); },
  };
}

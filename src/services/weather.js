import { DEFAULT_REGION, validateCoordinates } from './regions.js';

export function buildWeatherUrl(region = DEFAULT_REGION) {
  if (!validateCoordinates(region)) throw new WeatherError('location', '地區或座標無效，請重新選擇行政區。');
  return 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
  latitude: String(region.latitude), longitude: String(region.longitude), timezone: 'Asia/Taipei',
  current: 'temperature_2m,relative_humidity_2m,weather_code',
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  forecast_days: '7',
  });
}
export const WEATHER_URL = buildWeatherUrl();
export class WeatherError extends Error {
  constructor(kind, message) { super(message); this.name = 'WeatherError'; this.kind = kind; }
}
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const percent = (v) => v === null || (finite(v) && v >= 0 && v <= 100);
const validDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
export function parseWeather(data, fetchedAt = new Date().toISOString()) {
  const c = data?.current, d = data?.daily;
  const fields = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max'];
  if (!c || !d || !finite(c.temperature_2m) || !finite(c.relative_humidity_2m) || !percent(c.relative_humidity_2m) || !finite(c.weather_code)
    || typeof c.time !== 'string' || !Number.isFinite(Date.parse(`${c.time}+08:00`))
    || !Array.isArray(d.time) || d.time.length !== 7 || !d.time.every(validDate)
    || !fields.every((field) => Array.isArray(d[field]) && d[field].length === d.time.length)
    || data.current_units?.temperature_2m !== '°C' || data.current_units?.relative_humidity_2m !== '%'
    || data.daily_units?.temperature_2m_max !== '°C' || data.daily_units?.temperature_2m_min !== '°C'
    || data.daily_units?.precipitation_probability_max !== '%' || data.timezone !== 'Asia/Taipei') {
    throw new WeatherError('data', '天氣資料格式異常，請稍後重新整理。');
  }
  const forecast = d.time.map((date, i) => {
    const high = d.temperature_2m_max[i], low = d.temperature_2m_min[i], rain = d.precipitation_probability_max[i], code = d.weather_code[i];
    if (!finite(high) || !finite(low) || low > high || !percent(rain) || !finite(code)) throw new WeatherError('data', '預報資料異常，請稍後重新整理。');
    return { date, high, low, rain, code };
  });
  return { temperature: c.temperature_2m, humidity: c.relative_humidity_2m, code: c.weather_code, time: `${c.time}+08:00`, fetchedAt, forecast };
}
export async function fetchWeather({ region = DEFAULT_REGION, fetchImpl = fetch, timeout = 12000, signal } = {}) {
  const url = buildWeatherUrl(region);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new WeatherError('network', `天氣服務連線失敗（HTTP ${response.status}），請稍後重試。`);
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new WeatherError('data', '天氣服務回傳無法解析的資料。');
    }
    return { ...parseWeather(data), region };
  } catch (error) {
    if (error instanceof WeatherError) throw error;
    throw new WeatherError('network', error.name === 'AbortError' ? '連線逾時，請確認網路後重試。' : '無法連線至天氣服務，請確認網路後重試。');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export function weatherCondition(code) {
  if (code === 0) return { label: '晴朗', icon: 'sun' };
  if ([1, 2, 3].includes(code)) return { label: code === 3 ? '陰天' : '晴時多雲', icon: 'cloud' };
  if ([45, 48].includes(code)) return { label: '有霧', icon: 'cloud' };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: '有雨', icon: 'rain' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: '降雪', icon: 'cloud' };
  if ([95, 96, 99].includes(code)) return { label: '雷雨', icon: 'rain' };
  return { label: '天氣狀態未知', icon: 'cloud' };
}

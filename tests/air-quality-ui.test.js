// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { renderAirQuality } from '../src/components/air-quality.js';
import { parseAirQuality } from '../src/services/air-quality.js';
import { DEFAULT_REGION } from '../src/services/regions.js';
import { applySettings } from '../src/services/settings.js';
import { airFixture, airCaptured } from './fixtures/air-quality.js';
const now = Date.parse(airCaptured);
const state = () => ({ status: 'success', region: DEFAULT_REGION, data: parseAirQuality(airFixture(), { fetchedAt: airCaptured }), readAt: now, expiresAt: now + 300000, cached: false });
it('renders US AQI, separate PM units, real source/time and accessible trend values', () => {
  document.body.innerHTML = renderAirQuality(state(), { now });
  expect(document.body.textContent).toContain('美國 AQI（US AQI）'); expect(document.body.textContent).toContain('PM2.5'); expect(document.body.textContent).toContain('PM10'); expect(document.body.textContent).toContain('µg/m³'); expect(document.body.textContent).toContain('非臺灣環境部測站實測值'); expect(document.body.textContent).toContain('網頁讀取'); expect(document.querySelectorAll('circle')).toHaveLength(24); expect(document.querySelectorAll('.air-values li')).toHaveLength(24);
});
it('breaks the line for both null values and absent timestamps without interpolation', () => {
  const data = state(); data.data.points[5].aqi = null; data.data.points.splice(10, 1); document.body.innerHTML = renderAirQuality(data, { now });
  expect(document.querySelectorAll('polyline')).toHaveLength(3); expect(document.querySelectorAll('circle')).toHaveLength(22); expect(document.querySelectorAll('.air-values li')).toHaveLength(23);
});
it('shows missing index and zero PM distinctly, including missing trend data', () => {
  const data = state(); data.data.aqi = null; data.data.pm25 = 0; data.data.points = []; document.body.innerHTML = renderAirQuality(data, { now });
  expect(document.querySelector('.air-index').textContent).toContain('未提供'); expect(document.querySelectorAll('.air-metrics strong')[1].textContent).toContain('0'); expect(document.querySelector('svg')).toBeNull();
});
it('renders a compact summary with PM2.5 and no second large chart/card', () => {
  document.body.innerHTML = renderAirQuality(state(), { compact: true, now }); expect(document.querySelector('.air-compact')).not.toBeNull(); expect(document.querySelector('.card')).toBeNull(); expect(document.querySelector('svg')).toBeNull(); expect(document.body.textContent).not.toContain('PM10'); expect(document.body.textContent).toContain('8.1');
});
it('distinguishes cache reads, failed refreshes, expiry and old valid times', () => {
  const data = state(); data.cached = true; document.body.innerHTML = renderAirQuality(data, { now }); expect(document.body.textContent).toContain('未重新查詢 API');
  data.status = 'error'; data.error = Error('offline'); document.body.innerHTML = renderAirQuality(data, { now: now + 7 * 3600000 }); expect(document.body.textContent).toContain('保留舊資料'); expect(document.body.textContent).not.toContain('未重新查詢 API'); expect(document.body.textContent).toContain('快取已過期'); expect(document.body.textContent).toContain('超過 6 小時');
});
it('safely renders loading/error/invalid region with an actionable retry', () => {
  document.body.innerHTML = renderAirQuality({ status: 'error', region: null, error: Error('<img src=x onerror=alert(1)>') }); expect(document.querySelector('img')).toBeNull(); expect(document.body.textContent).toContain('<img'); expect(document.body.textContent).toContain('地區未選定'); expect(document.querySelector('[data-air-refresh]').disabled).toBe(false);
  document.body.innerHTML = renderAirQuality({ status: 'loading', region: DEFAULT_REGION }); expect(document.querySelector('[aria-busy]').getAttribute('aria-busy')).toBe('true'); expect(document.querySelector('button').disabled).toBe(true);
});
it('inherits all display modes, accents and font sizes with text labels for levels', () => {
  for (const mode of ['light', 'dark', 'system']) for (const accent of ['teal', 'blue', 'violet', 'rose', 'amber']) for (const fontSize of ['small', 'standard', 'large']) {
    applySettings({ mode, accent, fontSize }, document.documentElement, true); document.body.innerHTML = renderAirQuality(state(), { now }); expect(document.querySelector('.air-good').textContent).toContain('良好'); expect(document.documentElement.dataset.fontSize).toBe(fontSize);
  }
});

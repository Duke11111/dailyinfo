// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { airFixture } from './fixtures/air-quality.js';
import { quoteFixture } from './fixtures/quotes.js';
import { catalogFixture } from './fixtures/stock-catalog.js';
import { newsFixture } from './fixtures/news.js';
import { eqFixture } from './fixtures/earthquakes.js';
let app, airFetch;
const response = data => ({ ok: true, json: async () => data });
const weather = () => ({ timezone: 'Asia/Taipei', current: { time: '2026-10-20T00:00', temperature_2m: 26, relative_humidity_2m: 70, weather_code: 2 }, current_units: { temperature_2m: '°C', relative_humidity_2m: '%' }, daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%' }, daily: { time: Array.from({ length: 7 }, (_, i) => `2026-10-${20 + i}`), weather_code: Array(7).fill(2), temperature_2m_max: Array(7).fill(28), temperature_2m_min: Array(7).fill(22), precipitation_probability_max: Array(7).fill(20) } });
beforeEach(() => {
  vi.resetModules(); localStorage.clear(); document.body.innerHTML = '<a class="skip-link" href="#main">跳至主要內容</a><div id="app"></div>'; history.replaceState(null, '', '#/weather');
  airFetch = vi.fn(async url => { const raw = airFixture(), query = new URL(url).searchParams; raw.latitude = Number(query.get('latitude')); raw.longitude = Number(query.get('longitude')); return response(raw); });
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (String(url).includes('air-quality-api.')) return airFetch(url, options);
    if (String(url).includes('api.open-meteo.')) return response(weather());
    if (String(url).endsWith('quotes.json')) return response(quoteFixture());
    if (String(url).endsWith('stocks.json')) return response(catalogFixture());
    if (String(url).endsWith('news.json')) return response(newsFixture());
    if (String(url).endsWith('earthquakes.json')) return response(eqFixture());
    throw Error('unexpected request');
  }));
});
afterEach(() => { app?.dispose(); vi.unstubAllGlobals(); });
const boot = async () => { app = await import('../src/main.js'); };
function selectRegion(county, id) {
  for (const [selector, value] of [['#county-select', county], ['#district-select', id]]) { const input = document.querySelector(selector); input.value = value; input.dispatchEvent(new Event('change')); }
  document.querySelector('#region-form').dispatchEvent(new Event('submit', { cancelable: true }));
}
function route(name) { location.hash = `#/${name}`; window.dispatchEvent(new HashChangeEvent('hashchange')); }
it('links the existing county/district selection and coordinates to both services', async () => {
  await boot(); await vi.waitFor(() => expect(document.querySelector('#air-quality-host .air-good')).not.toBeNull());
  selectRegion('苗栗縣', '10005040'); await vi.waitFor(() => expect(document.querySelector('#air-quality-host').textContent).toContain('竹南鎮'));
  await vi.waitFor(() => expect(airFetch).toHaveBeenCalledTimes(2)); expect(airFetch.mock.calls[1][0]).toContain('latitude=24.711839'); await vi.waitFor(() => expect(document.querySelectorAll('.forecast-day')).toHaveLength(7)); expect(JSON.parse(localStorage.getItem('dailyinfo.region.v1')).id).toBe('10005040');
});
it('prevents a late old-region AQI response from replacing the new region', async () => {
  let resolveOld; airFetch.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })); await boot();
  await vi.waitFor(() => expect(airFetch).toHaveBeenCalledOnce()); selectRegion('高雄市', '64000030'); await vi.waitFor(() => expect(document.querySelector('#air-quality-host .air-good')).not.toBeNull());
  const old = airFixture(); old.current.us_aqi = 400; resolveOld(response(old)); await Promise.resolve(); await Promise.resolve();
  expect(document.querySelector('#air-quality-host').textContent).toContain('高雄市 左營區'); expect(document.querySelector('#air-quality-host .air-index strong').textContent).toBe('45');
});
it('reuses cached AQI across overview and weather and explicitly refreshes only when requested', async () => {
  await boot(); await vi.waitFor(() => expect(document.querySelector('#air-quality-host .air-good')).not.toBeNull()); route('overview');
  await vi.waitFor(() => expect(document.querySelector('.overview-air-host .air-good')).not.toBeNull()); expect(document.querySelectorAll('.overview-card')).toHaveLength(4); expect(document.querySelectorAll('.overview-day')).toHaveLength(7); expect(airFetch).toHaveBeenCalledTimes(1); expect(document.querySelector('.overview-air-host').textContent).toContain('未重新查詢 API');
  route('weather'); expect(airFetch).toHaveBeenCalledTimes(1); document.querySelector('[data-air-refresh]').click(); await vi.waitFor(() => expect(airFetch).toHaveBeenCalledTimes(2));
});
it('isolates AQI failures from weather and other homepage cards', async () => {
  airFetch.mockRejectedValue(Error('offline')); await boot(); await vi.waitFor(() => expect(document.querySelector('#air-quality-host [role=alert]')).not.toBeNull()); expect(document.querySelectorAll('.forecast-day')).toHaveLength(7);
  route('overview'); await vi.waitFor(() => expect(document.querySelector('.overview-news li')).not.toBeNull()); expect(document.querySelectorAll('.overview-day')).toHaveLength(7); expect(document.querySelector('.overview-earthquakes li')).not.toBeNull(); expect(document.querySelector('.overview-air-host [role=alert]')).not.toBeNull();
});

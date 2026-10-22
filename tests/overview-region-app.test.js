// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DEFAULT_REGION, REGION_KEY, getRegion } from '../src/services/regions.js';
import { OVERVIEW_REGION_KEY } from '../src/services/overview-region.js';
import { airFixture } from './fixtures/air-quality.js';
import { quoteFixture } from './fixtures/quotes.js';
import { catalogFixture } from './fixtures/stock-catalog.js';
import { newsFixture } from './fixtures/news.js';
import { eqFixture } from './fixtures/earthquakes.js';

let app, weatherFetch, airFetch;
const zhunan = getRegion('10005040'), zhongshan = getRegion('63000040');
const response = data => ({ ok: true, json: async () => data });
const weather = () => ({ timezone: 'Asia/Taipei', current: { time: '2026-10-22T00:00', temperature_2m: 26, relative_humidity_2m: 70, weather_code: 2 },
  current_units: { temperature_2m: '°C', relative_humidity_2m: '%' }, daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%' },
  daily: { time: Array.from({ length: 7 }, (_, i) => `2026-10-${22 + i}`), weather_code: Array(7).fill(2), temperature_2m_max: Array(7).fill(28), temperature_2m_min: Array(7).fill(22), precipitation_probability_max: Array(7).fill(20) } });
function air(url, aqi = 45) { const raw = airFixture(), params = new URL(url).searchParams; raw.latitude = Number(params.get('latitude')); raw.longitude = Number(params.get('longitude')); raw.current.us_aqi = aqi; return raw; }
beforeEach(() => {
  localStorage.clear(); weatherFetch = vi.fn(async () => response(weather())); airFetch = vi.fn(async url => response(air(url)));
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (String(url).includes('air-quality-api.')) return airFetch(url, options);
    if (String(url).includes('api.open-meteo.')) return weatherFetch(url, options);
    for (const [file, make] of Object.entries({ quotes: quoteFixture, stocks: catalogFixture, news: newsFixture, earthquakes: eqFixture })) if (String(url).endsWith(`${file}.json`)) return response(make());
    throw Error('Unavailable test snapshot');
  }));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; this.dispatchEvent(new Event('close')); } });
});
afterEach(() => { app?.dispose(); app = null; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete HTMLDialogElement.prototype.showModal; delete HTMLDialogElement.prototype.close; });
async function boot(route = 'overview') {
  vi.resetModules(); document.body.innerHTML = '<a class="skip-link" href="#main">跳至主要內容</a><div id="app"></div>'; history.replaceState(null, '', `#/${route}`); app = await import('../src/main.js');
}
function route(name) { history.replaceState(null, '', `#/${name}`); window.dispatchEvent(new HashChangeEvent('hashchange')); }
function homeDraft(region) {
  document.querySelector('.overview-region-control button').click();
  const [county, district] = document.querySelectorAll('.overview-region-dialog select'); county.value = region.county; county.dispatchEvent(new Event('change')); district.value = region.id;
}
function save() { document.querySelector('.overview-region-dialog form').dispatchEvent(new Event('submit', { cancelable: true })); }
async function homeReady(region) {
  await vi.waitFor(() => {
    expect(document.querySelectorAll('.overview-day')).toHaveLength(7);
    expect(document.querySelector('.overview-weather .overview-status').textContent).toContain(`${region.county} ${region.district}`);
    expect(document.querySelector('.overview-air-host .air-good')).not.toBeNull();
    expect(document.querySelector('.overview-air-host').textContent).toContain(`${region.county} ${region.district}`);
  });
}
function pageQuery(region) {
  const county = document.querySelector('#county-select'); county.value = region.county; county.dispatchEvent(new Event('change'));
  document.querySelector('#district-select').value = region.id; document.querySelector('#region-form').dispatchEvent(new Event('submit', { cancelable: true }));
}

it('requires an explicit save, restores Zhunan after reload and keeps both pages independent in either direction', async () => {
  await boot(); await homeReady(DEFAULT_REGION); expect(document.querySelector('.overview-region').textContent).toContain('尚未儲存');
  homeDraft(zhunan); expect(localStorage.getItem(OVERVIEW_REGION_KEY)).toBeNull();
  expect(document.querySelector('.overview-weather .overview-status').textContent).toContain('大安區');
  save(); await homeReady(zhunan); expect(JSON.parse(localStorage.getItem(OVERVIEW_REGION_KEY))).toEqual({ id: zhunan.id });
  expect(localStorage.getItem(REGION_KEY)).toBeNull();
  app.dispose(); app = null; await boot(); await homeReady(zhunan);
  route('weather'); pageQuery(zhongshan);
  await vi.waitFor(() => expect(document.querySelector('.source-note')?.textContent).toContain('臺北市 中山區'));
  expect(JSON.parse(localStorage.getItem(REGION_KEY)).id).toBe(zhongshan.id);
  route('overview'); await homeReady(zhunan); homeDraft(DEFAULT_REGION); save(); await homeReady(DEFAULT_REGION);
  expect(JSON.parse(localStorage.getItem(REGION_KEY)).id).toBe(zhongshan.id);
  route('weather'); await vi.waitFor(() => expect(document.querySelector('.source-note')?.textContent).toContain('臺北市 中山區'));
  expect(document.querySelector('#district-select').value).toBe(zhongshan.id);
});
it('cancels a draft without writes, requests or changes and preserves keyboard return focus', async () => {
  await boot(); await homeReady(DEFAULT_REGION); const calls = weatherFetch.mock.calls.length;
  homeDraft(zhunan); [...document.querySelectorAll('.overview-region-dialog button')].find(node => node.textContent === '取消').click();
  expect(localStorage.getItem(OVERVIEW_REGION_KEY)).toBeNull(); expect(weatherFetch).toHaveBeenCalledTimes(calls);
  expect(document.activeElement).toBe(document.querySelector('.overview-region-control button'));
  await homeReady(DEFAULT_REGION);
});
it('shares pending same-region requests across rapid page switches instead of issuing duplicate API calls', async () => {
  let weatherDone, airDone, airUrl;
  weatherFetch.mockImplementationOnce(() => new Promise(resolve => { weatherDone = resolve; }));
  airFetch.mockImplementationOnce(url => new Promise(resolve => { airDone = resolve; airUrl = url; }));
  await boot(); await vi.waitFor(() => expect(airDone).toBeTypeOf('function'));
  route('weather'); await new Promise(resolve => setTimeout(resolve, 0)); route('overview');
  expect(weatherFetch).toHaveBeenCalledTimes(1); expect(airFetch).toHaveBeenCalledTimes(1);
  weatherDone(response(weather())); airDone(response(air(airUrl))); await homeReady(DEFAULT_REGION);
  route('weather'); await vi.waitFor(() => expect(document.querySelectorAll('.forecast-day')).toHaveLength(7));
  expect(weatherFetch).toHaveBeenCalledTimes(1); expect(airFetch).toHaveBeenCalledTimes(1);
});
it('retains the previous saved region and raw storage when saving is refused', async () => {
  localStorage.setItem(OVERVIEW_REGION_KEY, JSON.stringify({ id: zhunan.id })); localStorage.setItem(REGION_KEY, JSON.stringify({ id: zhongshan.id }));
  await boot(); await homeReady(zhunan); const raw = localStorage.getItem(OVERVIEW_REGION_KEY), calls = weatherFetch.mock.calls.length;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota'); });
  homeDraft(DEFAULT_REGION); save(); expect(document.querySelector('.overview-region-dialog').open).toBe(true);
  expect(document.querySelector('.overview-region-dialog [role="alert"]').textContent).toContain('無法儲存');
  expect(localStorage.getItem(OVERVIEW_REGION_KEY)).toBe(raw); expect(weatherFetch).toHaveBeenCalledTimes(calls); await homeReady(zhunan);
});
it('does not overwrite corrupt settings or use supplied coordinates, and leaves the complete region picker intact', async () => {
  const raw = JSON.stringify({ id: zhunan.id, latitude: 0, longitude: 0 }); localStorage.setItem(OVERVIEW_REGION_KEY, raw);
  await boot(); await homeReady(DEFAULT_REGION); expect(document.querySelector('.overview-region').textContent).toContain('原始設定未被改寫');
  expect(localStorage.getItem(OVERVIEW_REGION_KEY)).toBe(raw); route('weather');
  expect(document.querySelector('#county-select').options).toHaveLength(22); expect(document.querySelector('#region-search')).not.toBeNull();
});
it('ignores delayed weather-page replies after returning to the independently saved homepage', async () => {
  localStorage.setItem(OVERVIEW_REGION_KEY, JSON.stringify({ id: zhunan.id })); localStorage.setItem(REGION_KEY, JSON.stringify({ id: zhongshan.id }));
  await boot(); await homeReady(zhunan); let done;
  weatherFetch.mockImplementationOnce(() => new Promise(resolve => { done = resolve; })); route('weather');
  await vi.waitFor(() => expect(done).toBeTypeOf('function')); route('overview'); await homeReady(zhunan);
  done(response(weather())); await new Promise(resolve => setTimeout(resolve, 0)); expect(weatherFetch).toHaveBeenCalledTimes(2); await homeReady(zhunan);
});
it('ignores old homepage weather and AQI after a quick saved-region change, using cached default data', async () => {
  await boot(); await homeReady(DEFAULT_REGION); let weatherDone, airDone, airUrl;
  weatherFetch.mockImplementationOnce(() => new Promise(resolve => { weatherDone = resolve; }));
  airFetch.mockImplementationOnce(url => new Promise(resolve => { airDone = resolve; airUrl = url; }));
  homeDraft(zhunan); save(); await vi.waitFor(() => expect(airDone).toBeTypeOf('function'));
  homeDraft(DEFAULT_REGION); save(); await homeReady(DEFAULT_REGION);
  weatherDone(response(weather())); airDone(response(air(airUrl, 400))); await new Promise(resolve => setTimeout(resolve, 0));
  await homeReady(DEFAULT_REGION); expect(document.querySelector('.overview-air-host .air-index strong').textContent).toBe('45');
  expect(weatherFetch).toHaveBeenCalledTimes(2); expect(airFetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(localStorage.getItem(OVERVIEW_REGION_KEY)).id).toBe(DEFAULT_REGION.id);
});
it('refreshes only the visible context at the original intervals and checks expiry on returning to foreground', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T00:00:00Z'));
  let hidden = false; vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
  localStorage.setItem(OVERVIEW_REGION_KEY, JSON.stringify({ id: zhunan.id })); localStorage.setItem(REGION_KEY, JSON.stringify({ id: zhongshan.id }));
  await boot(); await homeReady(zhunan); await vi.advanceTimersByTimeAsync(15 * 60000);
  expect(weatherFetch).toHaveBeenCalledTimes(2); expect(airFetch).toHaveBeenCalledTimes(1);
  expect(new URL(weatherFetch.mock.calls.at(-1)[0]).searchParams.get('latitude')).toBe(String(zhunan.latitude));
  route('weather'); await vi.waitFor(() => expect(document.querySelectorAll('.forecast-day')).toHaveLength(7));
  hidden = true; const calls = weatherFetch.mock.calls.length; await vi.advanceTimersByTimeAsync(30 * 60000); expect(weatherFetch).toHaveBeenCalledTimes(calls);
  hidden = false; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0);
  expect(weatherFetch).toHaveBeenCalledTimes(calls + 1);
  expect(new URL(weatherFetch.mock.calls.at(-1)[0]).searchParams.get('latitude')).toBe(String(zhongshan.latitude));
  expect(new URL(airFetch.mock.calls.at(-1)[0]).searchParams.get('latitude')).toBe(String(zhongshan.latitude));
});

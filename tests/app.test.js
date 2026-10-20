// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { REGION_KEY } from '../src/services/regions.js';
import { SETTINGS_KEY } from '../src/services/settings.js';

let app;
const response = () => ({ ok: true, json: async () => ({
  timezone: 'Asia/Taipei', current: { time: '2026-10-19T12:00', temperature_2m: 26, relative_humidity_2m: 70, weather_code: 2 },
  current_units: { temperature_2m: '°C', relative_humidity_2m: '%' },
  daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%' },
  daily: { time: Array.from({ length: 7 }, (_, i) => `2026-10-${19 + i}`), weather_code: Array(7).fill(2), temperature_2m_max: Array(7).fill(28), temperature_2m_min: Array(7).fill(22), precipitation_probability_max: Array(7).fill(20) },
}) });
async function boot(hash = '#/weather') {
  vi.resetModules();
  document.body.innerHTML = '<a class="skip-link" href="#main">跳至主要內容</a><div id="app"></div>';
  window.history.replaceState(null, '', hash);
  app = await import('../src/main.js');
}
function select(id, value) { const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); }
function submit() { document.querySelector('#region-form').dispatchEvent(new Event('submit', { cancelable: true })); }
beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response())); });
afterEach(() => { app?.dispose(); vi.unstubAllGlobals(); });

it('persists settings through application restart and keeps them across all routes', async () => {
  await boot('#/settings');
  for (const [name, value] of [['mode', 'dark'], ['accent', 'blue'], ['fontSize', 'large']]) {
    const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
    radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));
  }
  expect(JSON.parse(localStorage.getItem(SETTINGS_KEY))).toEqual({ mode: 'dark', accent: 'blue', fontSize: 'large' });
  app.dispose(); await boot('#/overview');
  for (const route of ['weather', 'stocks', 'news', 'earthquakes', 'settings']) {
    window.location.hash = `#/${route}`; window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(document.documentElement.dataset).toMatchObject({ theme: 'dark', accent: 'blue', fontSize: 'large' });
  }
  expect(document.querySelector('input[name="mode"][value="dark"]').checked).toBe(true);
});
it('persists a region and restores its canonical coordinates after restart', async () => {
  await boot();
  select('county-select', '苗栗縣'); select('district-select', '10005040'); submit();
  await vi.waitFor(() => expect(document.querySelector('.source-note')?.textContent).toContain('苗栗縣 竹南鎮'));
  expect(JSON.parse(localStorage.getItem(REGION_KEY))).toEqual({ id: '10005040' });
  app.dispose(); fetch.mockClear(); await boot();
  expect(fetch.mock.calls[0][0]).toContain('latitude=24.711839');
  expect(document.querySelector('#county-select').value).toBe('苗栗縣');
  expect(document.querySelector('#district-select').value).toBe('10005040');
});
it('prevents a slow old response from overwriting a newer region', async () => {
  let resolveOld;
  fetch.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  await boot();
  select('county-select', '高雄市'); select('district-select', '64000030'); submit();
  await vi.waitFor(() => expect(document.querySelector('.source-note')?.textContent).toContain('高雄市 左營區'));
  resolveOld(response());
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(document.querySelector('.source-note').textContent).toContain('高雄市 左營區');
  expect(document.querySelector('.source-note').textContent).not.toContain('臺北市');
});
it('keeps region search input intact when a weather response completes', async () => {
  let resolve;
  fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await boot();
  const input = document.querySelector('#region-search'); input.value = '竹南'; input.dispatchEvent(new Event('input'));
  resolve(response()); await vi.waitFor(() => expect(document.querySelector('.source-note')).not.toBeNull());
  expect(document.querySelector('#region-search')).toBe(input);
  expect(input.value).toBe('竹南'); expect(document.querySelector('#search-results').textContent).toContain('竹南鎮');
});

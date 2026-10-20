import './styles.css';
import './preferences.css';
import './stocks.css';
import './quotes.css';
import './news.css';
import './earthquakes.css';
import './overview.css';
import './air-quality.css';
import './exchange.css';
import './horoscope.css';
import { mountExchange } from './pages/exchange.js';
import { createAirQualitySession } from './services/air-quality.js';
import { renderAirQuality } from './components/air-quality.js';
import { mountOverview } from './pages/overview.js';
import { createRouter, routes } from './router.js';
import { icon } from './lib/icons.js';
import { fetchWeather } from './services/weather.js';
import { renderWeather } from './components/weather.js';
import { renderPlaceholder } from './pages/placeholder.js';
import { loadSettings, saveSettings, applySettings, watchSystemTheme, DEFAULT_SETTINGS, MODES, ACCENTS, FONT_SIZES } from './services/settings.js';
import { renderSettings } from './pages/settings.js';
import { loadRegion, saveRegion, validateCoordinates } from './services/regions.js';
import { mountRegionPicker } from './components/region-picker.js';
import { mountStocks } from './pages/stocks.js';
import { mountNews } from './pages/news.js';
import { mountEarthquakes } from './pages/earthquakes.js';

const state = { status: 'loading', data: null, error: null, region: loadRegion() };
let settings = loadSettings();
let settingsSaved = true;
let regionSaved = true;
let requestId = 0;
let requestController;
let overviewView = null;
let disposeStocks = () => {};
let disposeNews = () => {};
let disposeEarthquakes = () => {};
applySettings(settings);
const stopThemeWatcher = watchSystemTheme(() => settings);
let currentRoute = 'overview';
const app = document.querySelector('#app');
app.innerHTML = `<aside class="sidebar"><a class="brand" href="#/overview" aria-label="DailyInfo 首頁"><span class="brand-mark">D<span>•</span></span><span>DailyInfo<small>每日資訊整合平台</small></span></a><div class="nav-caption">WORKSPACE / 工作台</div><nav aria-label="主要導覽">${Object.entries(routes).map(([key, route]) => `<a class="nav-item" data-route="${key}" href="#/${key}">${icon(route.icon)}<span>${route.title}</span>${key === 'overview' ? '<span class="nav-point"></span>' : ''}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="phase-label"><span></span>PHASE 6C</div><strong>從每天的資訊開始</strong><p>一個入口，掌握生活脈動。</p><div class="version">DailyInfo <span>v0.10.0</span></div></div></aside>
<div class="workspace"><header class="topbar"><span class="breadcrumb">工作台 <span>/</span> <strong id="breadcrumb-title">每日總覽</strong></span><time class="today-date">${new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</time></header><main id="main" tabindex="-1"></main><footer>DailyInfo<span>每日資訊，清楚呈現。</span><span>期中專案 · Phase 6C</span></footer></div>`;
const main = document.querySelector('#main');
const airQuality = createAirQualitySession({ onChange: updateAirQualityContent });
document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  main.focus();
  main.scrollIntoView({ block: 'start' });
});
function render() {
  overviewView?.dispose(); overviewView = null;
  disposeStocks(); disposeStocks = () => {};
  disposeNews(); disposeNews = () => {};
  disposeEarthquakes(); disposeEarthquakes = () => {};
  const route = routes[currentRoute];
  document.title = `${route.title} · DailyInfo`;
  document.querySelector('#breadcrumb-title').textContent = route.title;
  document.querySelectorAll('[data-route]').forEach((link) => {
    const active = link.dataset.route === currentRoute;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  const isWeather = currentRoute === 'weather';
  main.innerHTML = `<div class="page-heading"><div><span class="eyebrow">${route.english}</span><h1>${route.title}<span class="heading-dot">.</span></h1><p>${route.description}</p></div>${isWeather ? `<button class="refresh-button" data-refresh ${state.status === 'loading' ? 'disabled' : ''}>${icon('refresh', state.status === 'loading' ? 'spinning' : '')}<span>${state.status === 'loading' ? '更新中' : '重新整理'}</span></button>` : ''}</div>
    ${currentRoute === 'overview' ? '<div id="overview-host"></div>' : isWeather ? `<div id="region-picker-host"></div><p id="region-storage-status" class="storage-status" role="status">${regionSaved ? '' : '無法儲存地區；重新載入時可能無法保留選擇。'}</p><div id="weather-content">${renderWeather(state)}</div><div id="air-quality-host">${renderAirQuality(airQuality.state)}</div>` : currentRoute === 'settings' ? renderSettings(settings, settingsSaved) : currentRoute === 'stocks' ? '<div id="stocks-host"></div>' : currentRoute === 'news' ? '<div id="news-host"></div>' : currentRoute === 'earthquakes' ? '<div id="earthquakes-host"></div>' : renderPlaceholder(currentRoute)}`;
  if (currentRoute === 'overview') overviewView = mountOverview(main.querySelector('#overview-host'), { weatherState: state, airState: airQuality.state, onRefreshWeather: () => loadWeather() });
  if (isWeather) mountRegionPicker(main.querySelector('#region-picker-host'), state.region, region => {
    if (!validateCoordinates(region)) return;
    state.region = region;
    regionSaved = saveRegion(region.id);
    main.querySelector('#region-storage-status').textContent = regionSaved ? '' : '無法儲存地區；重新載入時可能無法保留選擇。';
    loadWeather(true);
    airQuality.load(region);
  });
  if (currentRoute === 'stocks') {
    const isExchange = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('view') === 'exchange';
    const navigation = document.createElement('nav'); navigation.className = 'finance-nav'; navigation.setAttribute('aria-label', '財經資訊');
    navigation.innerHTML = `<a href="#/stocks" ${isExchange ? '' : 'aria-current="page"'}>股票行情與自選股</a><a href="#/stocks?view=exchange" ${isExchange ? 'aria-current="page"' : ''}>外幣匯率與換算</a>`;
    const host = main.querySelector('#stocks-host'); host.before(navigation);
    disposeStocks = isExchange ? mountExchange(host) : mountStocks(host);
  }
  if (currentRoute === 'news') disposeNews = mountNews(main.querySelector('#news-host'));
  if (currentRoute === 'earthquakes') disposeEarthquakes = mountEarthquakes(main.querySelector('#earthquakes-host'), { initialEventId: new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('event') });
  if (isWeather || currentRoute === 'overview') airQuality.load(state.region);
}
function updateAirQualityContent(next) {
  const host = main.querySelector('#air-quality-host');
  if (host) host.innerHTML = renderAirQuality(next);
  overviewView?.updateAirQuality(next);
}
function updateWeatherContent() {
  overviewView?.updateWeather(state);
  const content = main.querySelector('#weather-content');
  if (content) content.innerHTML = renderWeather(state);
  const refresh = main.querySelector('.page-heading [data-refresh]');
  if (refresh) {
    refresh.disabled = state.status === 'loading';
    refresh.innerHTML = `${icon('refresh', state.status === 'loading' ? 'spinning' : '')}<span>${state.status === 'loading' ? '更新中' : '重新整理'}</span>`;
  }
}
async function loadWeather(replace = false) {
  if (state.status === 'loading' && requestController && !replace) return;
  requestController?.abort();
  requestController = new AbortController();
  const id = ++requestId;
  const region = state.region;
  state.status = 'loading';
  state.data = null;
  updateWeatherContent();
  try {
    const data = await fetchWeather({ region, signal: requestController.signal });
    if (id !== requestId) return;
    state.data = data; state.status = 'success';
  } catch (error) {
    if (id !== requestId) return;
    state.error = error; state.status = 'error';
  } finally { if (id === requestId) updateWeatherContent(); }
}
app.addEventListener('click', (event) => {
  if (event.target.closest('[data-air-refresh]')) airQuality.load(state.region, { force: true });
  if (event.target.closest('[data-refresh]')) loadWeather();
  if (event.target.closest('[data-reset-settings]')) {
    settings = { ...DEFAULT_SETTINGS }; settingsSaved = saveSettings(settings); applySettings(settings); render();
    main.querySelector('[data-reset-settings]').focus();
  }
});
app.addEventListener('change', event => {
  if (!event.target.matches('#settings-form input[type="radio"]')) return;
  const { name, value } = event.target;
  const allowed = { mode: MODES, accent: ACCENTS, fontSize: FONT_SIZES };
  if (!Object.hasOwn(allowed, name) || !Object.hasOwn(allowed[name], value)) return;
  settings = { ...settings, [name]: value };
  settingsSaved = saveSettings(settings);
  applySettings(settings);
  main.querySelector('#settings-status').textContent = settingsSaved ? '設定已儲存，重新載入仍有效。' : '無法寫入瀏覽器儲存空間；目前設定僅在本次使用期間有效。';
});
const stopRouter = createRouter((route) => { currentRoute = route; render(); });
export function dispose() { airQuality.dispose(); overviewView?.dispose(); stopRouter(); stopThemeWatcher(); disposeStocks(); disposeNews(); disposeEarthquakes(); requestController?.abort(); requestId++; }
if (import.meta.hot) import.meta.hot.dispose(dispose);
loadWeather();

import { startAutoRefresh } from './services/auto-refresh.js';
import './styles.css';
import './preferences.css';
import './stocks.css';
import './quotes.css';
import './news.css';
import './earthquakes.css';
import './overview.css';
import './air-quality.css';
import './horoscope.css';
import { createAirQualitySession, fetchAirQuality } from './services/air-quality.js';
import { renderAirQuality } from './components/air-quality.js';
import { mountOverview } from './pages/overview.js';
import { createRouter, routes } from './router.js';
import { icon } from './lib/icons.js';
import { createWeatherSession } from './services/weather-session.js';
import { fetchWeather } from './services/weather.js';
import { createRegionalRequests } from './services/regional-requests.js';
import { loadOverviewRegion, saveOverviewRegion } from './services/overview-region.js';
import { renderWeather } from './components/weather.js';
import { renderPlaceholder } from './pages/placeholder.js';
import { loadSettings, saveSettings, applySettings, watchSystemTheme, DEFAULT_SETTINGS, MODES, ACCENTS, FONT_SIZES } from './services/settings.js';
import { renderSettings } from './pages/settings.js';
import { loadRegion, saveRegion, validateCoordinates } from './services/regions.js';
import { mountRegionPicker } from './components/region-picker.js';
import { mountStocks } from './pages/stocks.js';
import { mountNews } from './pages/news.js';
import { mountEarthquakes } from './pages/earthquakes.js';
import { mountCalendar } from './pages/calendar.js';
import './ui-polish.css';

const weatherCache = new Map(), airCache = new Map();
const weatherRequests = createRegionalRequests(fetchWeather), airRequests = createRegionalRequests(fetchAirQuality);
const weather = createWeatherSession({ region: loadRegion(), cache: weatherCache, fetcher: weatherRequests.load, onChange: next => { state = next; updateWeatherContent(); } });
let state = weather.state;
let overviewRegion = loadOverviewRegion();
const overviewWeather = createWeatherSession({ region: overviewRegion.region, cache: weatherCache, fetcher: weatherRequests.load, onChange: next => overviewView?.updateWeather(next) });
let settings = loadSettings();
let settingsSaved = true;
let regionSaved = true;
let overviewView = null;
let disposeStocks = () => {};
let disposeNews = () => {};
let disposeEarthquakes = () => {};
let disposeCalendar = () => {};
applySettings(settings);
const stopThemeWatcher = watchSystemTheme(() => settings);
let currentRoute = 'overview';
const app = document.querySelector('#app');
app.innerHTML = `<aside class="sidebar"><a class="brand" href="#/overview" aria-label="DailyInfo 首頁"><span class="brand-mark">D<span>•</span></span><span>DailyInfo<small>每日資訊整合平台</small></span></a><div class="nav-caption">WORKSPACE / 工作台</div><nav aria-label="主要導覽">${Object.entries(routes).map(([key, route]) => `<a class="nav-item" data-route="${key}" href="#/${key}">${icon(route.icon)}<span>${route.title}</span>${key === 'overview' ? '<span class="nav-point"></span>' : ''}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="phase-label"><span></span>每日資訊整合平台</div><strong>從每天的資訊開始</strong><p>一個入口，掌握生活脈動。</p><div class="version">DailyInfo <span>讓每一天更有條理</span></div></div></aside>
<div class="workspace"><header class="topbar"><span class="breadcrumb">工作台 <span>/</span> <strong id="breadcrumb-title">每日總覽</strong></span><time class="today-date">${new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</time></header><main id="main" tabindex="-1"></main><footer>DailyInfo<span>每日資訊，清楚呈現。</span><span>每日生活資訊工作台</span></footer></div>`;
const main = document.querySelector('#main');
const airQuality = createAirQualitySession({ onChange: updateAirQualityContent, cache: airCache, initialRegion: state.region, fetcher: airRequests.load });
const overviewAir = createAirQualitySession({ onChange: next => overviewView?.updateAirQuality(next), cache: airCache, initialRegion: overviewRegion.region, fetcher: airRequests.load });
const activeWeather = () => currentRoute === 'overview' ? overviewWeather : weather;
const activeAir = () => currentRoute === 'overview' ? overviewAir : airQuality;
function saveHomeRegion(region) {
  const next = saveOverviewRegion(region.id); // Never change the view before storage succeeds.
  overviewRegion = next; overviewWeather.load(next.region); overviewAir.load(next.region); return next;
}
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
  disposeCalendar(); disposeCalendar = () => {};
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
    ${currentRoute === 'overview' ? '<div id="overview-host"></div>' : isWeather ? `<div id="region-picker-host"></div><p id="region-storage-status" class="storage-status" role="status">${regionSaved ? '' : '無法儲存地區；重新載入時可能無法保留選擇。'}</p><div id="weather-content">${renderWeather(state)}</div><div id="air-quality-host">${renderAirQuality(airQuality.state)}</div>` : currentRoute === 'settings' ? renderSettings(settings, settingsSaved) : currentRoute === 'stocks' ? '<div id="stocks-host"></div>' : currentRoute === 'news' ? '<div id="news-host"></div>' : currentRoute === 'earthquakes' ? '<div id="earthquakes-host"></div>' : currentRoute === 'calendar' ? '<div id="calendar-host"></div>' : renderPlaceholder(currentRoute)}`;
  if (currentRoute === 'overview') {
    overviewWeather.load(); overviewAir.load(overviewWeather.state.region);
    overviewView = mountOverview(main.querySelector('#overview-host'), { weatherState: overviewWeather.state, airState: overviewAir.state, onRefreshWeather: () => overviewWeather.load(undefined, { force: true }), regionSetting: overviewRegion, onSaveRegion: saveHomeRegion });
  }
  if (isWeather) mountRegionPicker(main.querySelector('#region-picker-host'), state.region, region => {
    if (!validateCoordinates(region)) return;
    regionSaved = saveRegion(region.id);
    main.querySelector('#region-storage-status').textContent = regionSaved ? '' : '無法儲存地區；重新載入時可能無法保留選擇。';
    weather.load(region, { force: true });
    airQuality.load(region);
  });
  if (currentRoute === 'stocks') disposeStocks = mountStocks(main.querySelector('#stocks-host'));
  if (currentRoute === 'news') disposeNews = mountNews(main.querySelector('#news-host'));
  if (currentRoute === 'calendar') disposeCalendar = mountCalendar(main.querySelector('#calendar-host'));
  if (currentRoute === 'earthquakes') disposeEarthquakes = mountEarthquakes(main.querySelector('#earthquakes-host'), { initialEventId: new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('event') });
  if (isWeather) { weather.load(); airQuality.load(state.region); }
}
function updateAirQualityContent(next) {
  const host = main.querySelector('#air-quality-host');
  if (host) host.innerHTML = renderAirQuality(next);
}
function updateWeatherContent() {
  const content = main.querySelector('#weather-content');
  if (content) content.innerHTML = renderWeather(state);
  const refresh = main.querySelector('.page-heading [data-refresh]');
  if (refresh) {
    refresh.disabled = state.status === 'loading';
    refresh.innerHTML = `${icon('refresh', state.status === 'loading' ? 'spinning' : '')}<span>${state.status === 'loading' ? '更新中' : '重新整理'}</span>`;
  }
}
app.addEventListener('click', (event) => {
  if (event.target.closest('[data-air-refresh]')) activeAir().load(activeWeather().state.region, { force: true });
  if (event.target.closest('[data-refresh]')) weather.load(undefined, { force: true });
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
const stopAutoRefresh = startAutoRefresh([
  { interval: 15 * 60000, lastAt: () => activeWeather().lastAttemptAt, due: () => activeWeather().needsRefresh, enabled: () => ['weather', 'overview'].includes(currentRoute), run: () => activeWeather().load(undefined, { force: true }) },
  { interval: 30 * 60000, lastAt: () => Date.parse(activeAir().state.data?.fetchedAt) || 0, enabled: () => ['weather', 'overview'].includes(currentRoute), run: () => activeAir().load(activeWeather().state.region, { force: true }) },
]);
export function dispose() { stopAutoRefresh(); weather.dispose(); overviewWeather.dispose(); airQuality.dispose(); overviewAir.dispose(); weatherRequests.dispose(); airRequests.dispose(); weatherCache.clear(); airCache.clear(); overviewView?.dispose(); stopRouter(); stopThemeWatcher(); disposeCalendar(); disposeStocks(); disposeNews(); disposeEarthquakes(); }
if (import.meta.hot) import.meta.hot.dispose(dispose);

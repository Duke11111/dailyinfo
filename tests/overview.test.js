// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountOverview } from '../src/pages/overview.js';
import { loadWatchlists, WATCHLIST_KEY } from '../src/services/watchlists.js';
import { DEFAULT_REGION, getRegion } from '../src/services/regions.js';
import { applySettings } from '../src/services/settings.js';
import { quoteFixture } from './fixtures/quotes.js';
import { newsFixture } from './fixtures/news.js';
import { eqFixture } from './fixtures/earthquakes.js';
import { mountEarthquakes } from '../src/pages/earthquakes.js';
import { catalogFixture } from './fixtures/stock-catalog.js';

let view;
const captured = Date.parse('2026-10-19T16:00:00Z');
const weather = () => ({ status: 'success', region: DEFAULT_REGION, data: { temperature: 26, code: 2, time: '2026-10-19T23:00:00+08:00', fetchedAt: '2026-10-19T15:30:00Z', forecast: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${19 + i}`, high: 28, low: 22, rain: 20, code: 2 })) } });
const store = data => ({ peek: () => null, load: vi.fn(async () => ({ data, readAt: captured })) });
function boot(options = {}) {
  const sources = { quotes: store(quoteFixture()), news: store(newsFixture()), earthquakes: store(eqFixture()), onRefreshWeather: vi.fn() };
  view = mountOverview(document.querySelector('#host'), { ...sources, loadCatalog: async () => catalogFixture(), weatherState: weather(), now: () => captured, ...options }); return sources;
}
function seed() {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify({ version: 1, activeId: 'tech', sort: 'custom', groups: [{ id: 'tech', name: '科技股', stocks: [{ code: '2330', name: '台積電', type: 'stock' }, { code: '2454', name: '聯發科', type: 'stock' }] }, { id: 'etf', name: 'ETF', stocks: [{ code: '0050', name: '元大台灣50', type: 'etf' }] }] }));
}
const settled = () => vi.waitFor(() => expect(document.querySelector('.overview-news').textContent).toContain('台灣科技發展'));
beforeEach(() => { document.body.innerHTML = '<div id="host"></div>'; localStorage.clear(); });
afterEach(() => { view?.dispose(); document.documentElement.removeAttribute('data-theme'); document.documentElement.removeAttribute('data-accent'); document.documentElement.removeAttribute('data-font-size'); });
it('renders all four summaries, accurate dates, sources and seven forecast days', async () => {
  seed(); boot(); await settled();
  expect(document.querySelectorAll('.overview-card')).toHaveLength(4);
  expect(document.querySelectorAll('.overview-day')).toHaveLength(7);
  expect(document.querySelector('.overview-today').textContent).toContain('今天');
  expect(document.querySelector('.overview-weather').textContent).toContain('臺北市 大安區');
  expect(document.querySelector('.overview-weather').textContent).toContain('非測站即時觀測');
  const stocks = document.querySelector('.overview-stocks');
  expect(stocks.textContent).toContain('2,420.00'); expect(stocks.textContent).toContain('−20.00'); expect(stocks.textContent).toContain('2026-10-16');
  expect(stocks.textContent).toContain('盤後'); expect(stocks.textContent).toContain('2026/10/19');
  expect(document.querySelector('.overview-earthquakes').textContent).toContain('規模 4.6 · 最大觀測震度 2級');
  expect(document.querySelector('.overview-news a[target="_blank"]').rel).toContain('noopener');
  expect(document.querySelectorAll('.overview-source>a')).toHaveLength(4);
});
it('places the agenda then horoscope together ahead of all four summaries without dropping sources', async () => {
  boot(); await settled();
  const agenda = document.querySelector('.today-agenda'), grid = document.querySelector('.overview-grid'), horoscope = document.querySelector('.horoscope-card');
  expect(agenda.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(agenda.compareDocumentPosition(horoscope) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(horoscope.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelector('.overview-personal').contains(agenda)).toBe(true);
  expect(document.querySelector('.overview-personal').contains(horoscope)).toBe(true);
  expect(document.querySelectorAll('.overview-source>a')).toHaveLength(4);
  expect(horoscope.textContent).toContain('星座運勢僅供娛樂參考');
  expect(agenda.querySelector('a[href="#/calendar"]')).not.toBeNull();
});
it('reads existing groups and switches summary without writing any user data', async () => {
  seed(); localStorage.setItem('dailyinfo.news.favorites.v1', 'keep'); const before = { ...localStorage };
  boot(); await settled(); const select = document.querySelector('.overview-stocks select'); select.value = 'etf'; select.dispatchEvent(new Event('change'));
  expect(document.querySelector('.overview-stock-table').textContent).toContain('109.00');
  expect(document.querySelector('.overview-stock-table').textContent).not.toContain('台積電');
  expect({ ...localStorage }).toEqual(before);
});
it('provides real common-stock exploration and entry points when no stocks are selected', async () => {
  const original = { ...localStorage }; boot(); await settled(); const content = document.querySelector('.overview-stocks');
  expect(content.textContent).toContain('新增自選股'); expect(content.textContent).toContain('查看股票市場'); expect(content.textContent).toContain('常見關注股票'); expect(content.textContent).toContain('2,420.00'); expect(content.textContent).toContain('2026-10-16'); expect(content.querySelectorAll('tbody tr')).toHaveLength(2); expect({ ...localStorage }).toEqual(original);
});
it('does not load exploration catalog for an existing personalized group', async () => {
  seed(); const loadCatalog = vi.fn(); boot({ loadCatalog }); await settled(); expect(loadCatalog).not.toHaveBeenCalled(); expect(document.querySelector('.overview-stocks h3')).toBeNull();
});
it('limits homepage common summary to four valid products and restores personal stocks after remount', async () => {
  const data = quoteFixture(), catalog = catalogFixture();
  for (const code of ['2317', '2303', '2881', '2454']) { if (!catalog.stocks.some(stock => stock.code === code)) catalog.stocks.push({ code, name: code, type: 'stock' }); if (!data.quotes.some(quote => quote.code === code)) data.quotes.push({ ...data.quotes[0], code }); }
  boot({ quotes: store(data), loadCatalog: async () => catalog }); await settled(); expect(document.querySelectorAll('.overview-stocks tbody tr')).toHaveLength(4);
  view.dispose(); seed(); boot(); await settled(); expect(document.querySelector('.overview-stocks h3')).toBeNull(); expect(document.querySelectorAll('.overview-stocks tbody tr')).toHaveLength(2);
});
it('isolates homepage catalog failures and permits an explicit retry', async () => {
  const loadCatalog = vi.fn().mockRejectedValueOnce(Error('目錄離線')).mockResolvedValueOnce(catalogFixture()); boot({ loadCatalog }); await settled();
  expect(document.querySelector('.overview-stocks').textContent).toContain('目錄離線'); expect(document.querySelector('.overview-news li')).not.toBeNull();
  [...document.querySelectorAll('.overview-stocks button')].find(node => node.textContent === '重試股票目錄').click();
  await vi.waitFor(() => expect(document.querySelector('.overview-stocks tbody')).not.toBeNull()); expect(loadCatalog).toHaveBeenCalledTimes(2);
});
it('does not replace corrupt watchlist storage and still renders other modules', async () => {
  localStorage.setItem(WATCHLIST_KEY, '{broken'); boot(); await settled(); expect(document.querySelector('.overview-stocks').textContent).toContain('資料損壞'); expect(localStorage.getItem(WATCHLIST_KEY)).toBe('{broken');
});
it('shows missing quotes without zero or fictitious prices', async () => {
  seed(); const data = quoteFixture(); data.quotes = []; boot({ quotes: store(data) }); await settled(); expect(document.querySelector('tbody').textContent).toContain('暫無行情'); expect(document.querySelector('tbody').textContent).not.toContain('0.00');
});
it('isolates individual snapshot failures and retries only the selected service', async () => {
  const news = store(null); news.load.mockRejectedValueOnce(Error('新聞離線')); const sources = boot({ news });
  await vi.waitFor(() => expect(document.querySelector('.overview-news [role=alert]').textContent).toContain('新聞離線'));
  expect(document.querySelector('.overview-earthquakes').textContent).toContain('規模 4.6'); expect(document.querySelector('.overview-weather').textContent).toContain('26°C');
  news.load.mockResolvedValueOnce({ data: newsFixture(), readAt: captured }); document.querySelector('.overview-news button').click(); await settled();
  expect(news.load).toHaveBeenLastCalledWith({ force: true }); expect(sources.earthquakes.load).toHaveBeenCalledTimes(1);
});
it('keeps last good cards on failed reread and marks stale snapshots honestly', async () => {
  const news = store(newsFixture()); boot({ news, now: () => captured + 2 * 86400000 }); await settled();
  news.load.mockRejectedValueOnce(Error('offline')); document.querySelector('.overview-news button').click();
  await vi.waitFor(() => expect(document.querySelector('.overview-news [role=alert]').textContent).toContain('offline'));
  expect(document.querySelector('.overview-news').textContent).toContain('台灣科技發展'); expect(document.querySelector('.overview-news').textContent).toContain('可能過期');
  expect(document.querySelector('.overview-notice').textContent).toContain('不會更新外部 API');
});
it('handles weather loading, failure, retry and updated saved region independently', async () => {
  const sources = boot(); await settled(); view.updateWeather({ ...weather(), status: 'loading' }); expect(document.querySelector('[data-overview-weather-refresh]').disabled).toBe(true);
  view.updateWeather({ ...weather(), status: 'error', error: Error('天氣逾時') }); expect(document.querySelector('.overview-weather [role=alert]').textContent).toContain('天氣逾時');
  document.querySelector('[data-overview-weather-refresh]').click(); expect(sources.onRefreshWeather).toHaveBeenCalledOnce();
  view.updateWeather({ ...weather(), region: getRegion('10005040') }); expect(document.querySelector('.overview-weather').textContent).toContain('苗栗縣 竹南鎮');
});
it('renders API/user text safely and sorts news newest first', async () => {
  seed(); const snapshot = newsFixture(); snapshot.articles[0].title = '<img src=x onerror=alert(1)>'; snapshot.articles.reverse();
  boot({ news: store(snapshot) }); await vi.waitFor(() => expect(document.querySelector('.overview-news li')?.textContent).toContain('<img'));
  expect(document.querySelector('.overview-news img')).toBeNull(); expect(document.querySelectorAll('script')).toHaveLength(0);
});
it('shows explicit empty news and earthquake summaries', async () => {
  const n = newsFixture(), q = eqFixture(); n.articles = []; q.events = []; boot({ news: store(n), earthquakes: store(q) });
  await vi.waitFor(() => expect(document.querySelector('.overview-news').textContent).toContain('沒有可顯示'));
  expect(document.querySelector('.overview-earthquakes').textContent).toContain('沒有地震紀錄');
});
it('supports inherited theme/font settings and all module navigation links', async () => {
  applySettings({ mode: 'dark', accent: 'violet', fontSize: 'large' }); boot(); await settled();
  expect(document.documentElement.dataset).toMatchObject({ theme: 'dark', accent: 'violet', fontSize: 'large' });
  for (const route of ['weather', 'stocks', 'news', 'earthquakes']) expect(document.querySelector(`.overview-${route} .overview-card-heading a`).getAttribute('href')).toBe(`#/${route}`);
});
it('ignores pending responses once the overview has been disposed', async () => {
  let resolve; const news = store(null); news.load = () => new Promise(done => { resolve = done; }); boot({ news }); view.dispose(); const before = document.querySelector('#host').innerHTML;
  resolve({ data: newsFixture(), readAt: captured }); await Promise.resolve(); expect(document.querySelector('#host').innerHTML).toBe(before);
});
it('links a homepage earthquake directly to matching details and map selection', async () => {
  boot(); await settled(); const href = document.querySelector('.overview-earthquakes li>a').getAttribute('href'); const id = new URLSearchParams(href.split('?')[1]).get('event');
  view.dispose(); const map = { setEvents: vi.fn(), select: vi.fn(), destroy: vi.fn() };
  const dispose = mountEarthquakes(document.querySelector('#host'), { store: store(eqFixture()), initialEventId: id, mapFactory: async () => map });
  try { await vi.waitFor(() => expect(document.querySelector('.eq-detail').textContent).toContain('宜蘭縣南澳鄉')); expect(map.select).toHaveBeenLastCalledWith(id, true); }
  finally { dispose(); }
});
it('ignores unknown earthquake detail identifiers without breaking the list', async () => {
  const dispose = mountEarthquakes(document.querySelector('#host'), { store: store(eqFixture()), initialEventId: '<script>', mapFactory: async () => ({ setEvents() {}, select() {}, destroy() {} }) });
  try { await vi.waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(2)); expect(document.querySelector('.eq-active-row')).toBeNull(); }
  finally { dispose(); }
});

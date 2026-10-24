import { startAutoRefresh } from '../services/auto-refresh.js';
import { loadWatchlists, sortedStocks } from '../services/watchlists.js';
import { quoteStore, QUOTE_SOURCE } from '../services/quotes.js';
import { newsStore, NEWS_CATEGORIES, NEWS_RSS_PAGE, filterNews } from '../services/news.js';
import { earthquakeStore, EQ_SOURCE_URL } from '../services/earthquakes.js';
import { regionLabel } from '../services/regions.js';
import { weatherCondition, todayForecast, weatherDate } from '../services/weather.js';
import { weatherIcon } from '../lib/weather-icons.js';
import { formatTime, formatNumber, dayLabel } from '../lib/format.js';
import { formatEarthquakeTime } from '../lib/earthquake-format.js';
import { quoteNumber, signedQuote, quoteDirection } from '../components/quote-details.js';
import { loadStockCatalog } from '../services/stock-catalog.js';
import { explorationEntries } from '../services/stock-exploration.js';
import { renderAirQuality } from '../components/air-quality.js';
import { mountHoroscope } from '../components/horoscope.js';
import { mountTodayAgenda } from '../components/today-agenda.js';
import { mountOverviewRegion } from '../components/overview-region.js';

const el = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
function link(label, href, external = false) {
  const node = el('a', label); node.href = href;
  if (external) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
  return node;
}
function button(label, action) { const node = el('button', label, 'overview-refresh'); node.type = 'button'; node.addEventListener('click', action); return node; }

// Snapshot services perform validation and share their request/cache with full pages.
// Personal region changes are explicit and delegated to the application.
export function mountOverview(host, { weatherState, airState, onRefreshWeather, regionSetting, onSaveRegion, quotes = quoteStore, news = newsStore, earthquakes = earthquakeStore, watchlists = loadWatchlists(), loadCatalog = loadStockCatalog, now = Date.now } = {}) {
  let alive = true;
  const jobs = [];
  const grid = el('div', '', 'overview-grid');
  const notice = el('p', '天氣直接查詢 Open-Meteo；股票、新聞與地震讀取網站已發布的資料快照。「重新讀取快照」不會更新外部 API。所有時間皆為臺灣時間。', 'overview-notice');
  const horoscopeHost = el('div');
  const agendaHost = el('div');
  const personal = el('div', '', 'overview-personal');
  personal.append(agendaHost, horoscopeHost);
  host.replaceChildren(notice, personal, grid);
  jobs.push(mountTodayAgenda(agendaHost, { now }));
  jobs.push(mountHoroscope(horoscopeHost));
  function card(key, title, subtitle, sourceName, sourceUrl) {
    const node = el('section', '', `card overview-card overview-${key}`); node.setAttribute('aria-labelledby', `overview-${key}-title`);
    const header = el('div', '', 'overview-card-heading'), heading = el('div');
    const h2 = el('h2', title); h2.id = `overview-${key}-title`; heading.append(el('span', subtitle, 'eyebrow'), h2);
    header.append(heading, link('完整頁面 →', `#/${key}`));
    const status = el('p', '', 'overview-status'); status.setAttribute('role', 'status');
    const error = el('p', '', 'overview-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const content = el('div', '', 'overview-content'), footer = el('div', '', 'overview-source');
    footer.append(link(`來源：${sourceName}`, sourceUrl, true));
    const metadata = el('p'), actions = el('div', '', 'overview-actions'); footer.append(metadata, actions);
    node.append(header, status, error, content, footer); grid.append(node);
    return { node, status, error, content, metadata, actions };
  }
  const weather = card('weather', '天氣摘要', 'WEATHER / 七日展望', 'Open-Meteo', 'https://open-meteo.com/');
  const weatherRefresh = button('更新天氣預報', () => onRefreshWeather?.()); weatherRefresh.dataset.overviewWeatherRefresh = '';
  weather.actions.append(weatherRefresh, link('查詢其他地區', '#/weather'));
  if (regionSetting && onSaveRegion) {
    const regionHost = el('div', '', 'overview-region'); weather.node.insertBefore(regionHost, weather.status);
    jobs.push(mountOverviewRegion(regionHost, { selection: regionSetting, onSave: onSaveRegion }));
  }
  function updateWeather(state) {
    if (!alive || !state) return;
    weather.content.replaceChildren(); weather.error.hidden = state.status !== 'error';
    weather.error.textContent = state.status === 'error' ? state.error?.message || '天氣查詢失敗，請重試。' : '';
    weatherRefresh.disabled = state.status === 'loading'; weather.node.setAttribute('aria-busy', String(state.status === 'loading'));
    weather.status.textContent = `${regionLabel(state.region)} · ${state.status === 'loading' ? '正在查詢天氣…' : '數值模式預報，非測站即時觀測'}`;
    weather.metadata.textContent = '降雨為每日最高預報機率；缺值以「—」表示。';
    if (state.status !== 'success' || !state.data) return;
    const w = state.data, current = el('div', '', 'overview-weather-current');
    const today = todayForecast(w, now());
    if (!today || weatherDate(Date.parse(w.time)) !== weatherDate(now())) {
      weather.error.hidden = false; weather.error.textContent = '非當日有效天氣，請重新取得資料；不將舊預報視為今天。';
    }
    const symbol = el('span', '', 'overview-weather-symbol'); symbol.innerHTML = weatherIcon(w.code); // trusted, fixed SVG only
    current.append(symbol, el('strong', `${formatNumber(w.temperature)}°C`), el('span', weatherCondition(w.code).label), el('span', `今日降雨 ${formatNumber(today?.rain)}${today?.rain == null ? '' : '%'}`));
    const days = el('div', '', 'overview-days'); days.setAttribute('aria-label', '未來七日預報摘要');
    w.forecast.slice(0, 7).forEach((day, index) => {
      const item = el('div', '', `overview-day${day.date === weatherDate(now()) ? ' overview-today' : ''}`), date = el('time', day.date.slice(5).replace('-', '/')); date.dateTime = day.date;
      const symbol = el('span'); symbol.innerHTML = weatherIcon(day.code); symbol.setAttribute('aria-label', weatherCondition(day.code).label); symbol.setAttribute('role', 'img');
      item.append(el('strong', dayLabel(day.date, index, now())), date, symbol, el('span', `${formatNumber(day.high)}° / ${formatNumber(day.low)}°`), el('small', `雨 ${formatNumber(day.rain)}${day.rain == null ? '' : '%'}`)); days.append(item);
    });
    weather.content.append(current, days);
    weather.metadata.textContent = `每日預報日期：${w.forecast[0].date} ～ ${w.forecast.at(-1).date} · 預報有效：${formatTime(w.time)} · 擷取：${formatTime(w.fetchedAt)}。降雨為每日最高機率；「—」為未提供。`;
  }
  updateWeather(weatherState);
  const airHost = el('div', '', 'overview-air-host'); weather.node.insertBefore(airHost, weather.metadata.parentElement);
  function updateAirQuality(next) { if (alive && next) airHost.innerHTML = renderAirQuality(next, { compact: true, now: now() }); }
  updateAirQuality(airState);

  const stocks = card('stocks', '自選股摘要', 'STOCKS / 盤後行情', '臺灣證券交易所', QUOTE_SOURCE);
  let groupId = watchlists.data.activeId;
  let explorationCatalog = null, catalogRequested = false, catalogLoading = false, catalogError = '';
  const catalogController = new AbortController();
  jobs.push(() => catalogController.abort());
  async function requestExplorationCatalog() {
    if (catalogRequested) return;
    catalogRequested = true; catalogLoading = true; catalogError = '';
    try { const result = await loadCatalog({ signal: catalogController.signal }); if (alive) explorationCatalog = result; }
    catch (error) { if (alive) catalogError = error.message; }
    finally { if (alive) { catalogLoading = false; rerenderStocks(); } }
  }
  const selector = el('select'); selector.setAttribute('aria-label', '首頁自選股群組');
  watchlists.data.groups.forEach(group => selector.add(new Option(group.name, group.id))); selector.value = groupId ?? '';
  if (watchlists.data.groups.length) stocks.node.insertBefore(selector, stocks.status);
  const renderStocks = snapshot => {
    stocks.content.replaceChildren();
    if (watchlists.problem) stocks.content.append(el('p', `自選股讀取提示：${watchlists.problem}。原始儲存資料未變更。`, 'overview-error'));
    const group = watchlists.data.groups.find(item => item.id === groupId);
    const selected = group ? sortedStocks(group, watchlists.data.sort) : [];
    if (!selected.length) {
      requestExplorationCatalog();
      stocks.content.append(el('h3', '常見關注股票'), el('p', '此群組尚無自選股，先瀏覽固定關注清單；不是搜尋人氣排行。', 'overview-caption'));
      const entries = explorationEntries(explorationCatalog, snapshot, { mode: 'common', limit: 6 }).filter(item => Number.isFinite(item.quote?.close) && item.quote.close > 0).slice(0, 4);
      if (entries.length) {
        const wrapper = el('div', '', 'overview-table-scroll'), table = el('table', '', 'overview-stock-table'); table.setAttribute('aria-label', '常見關注股票盤後摘要');
        const head = el('thead'), row = el('tr'); ['股票', '收盤價', '漲跌幅'].forEach(text => { const th = el('th', text); th.scope = 'col'; row.append(th); }); head.append(row); table.append(head);
        const body = el('tbody'); entries.forEach(({ stock, quote }) => {
          const tr = el('tr'), name = el('td'); name.append(link(`${stock.code} ${stock.name}`, '#/stocks'));
          tr.append(name, el('td', quoteNumber(quote.close)), el('td', signedQuote(quote.percent, '%'), quoteDirection(quote.percent))); body.append(tr);
        }); table.append(body); wrapper.append(table); stocks.content.append(wrapper);
      } else stocks.content.append(el('p', catalogLoading ? '正在讀取股票目錄…' : catalogError ? `股票目錄讀取失敗：${catalogError}` : '目前沒有可用的常見關注行情。', 'overview-caption'));
      if (catalogError) stocks.content.append(button('重試股票目錄', () => { catalogRequested = false; rerenderStocks(); }));
      const actions = el('div', '', 'overview-actions'); actions.append(link('查看股票市場 →', '#/stocks'), link('建立／新增自選股 →', '#/stocks')); stocks.content.append(actions); return;
    }
    if (!snapshot) { stocks.content.append(el('p', `已保留 ${selected.length} 檔自選股，行情尚未取得。`)); return; }
    const lookup = new Map(snapshot.quotes.map(item => [item.code, item]));
    const wrapper = el('div', '', 'overview-table-scroll'), table = el('table', '', 'overview-stock-table'); table.setAttribute('aria-label', `${group.name}盤後行情摘要`);
    const head = el('thead'), row = el('tr'); ['股票', '收盤價', '漲跌額', '漲跌幅'].forEach(text => { const th = el('th', text); th.scope = 'col'; row.append(th); }); head.append(row); table.append(head);
    const body = el('tbody'); selected.slice(0, 5).forEach(stock => {
      const quote = lookup.get(stock.code), tr = el('tr'), name = el('td'); name.append(link(`${stock.code} ${stock.name}`, '#/stocks'));
      tr.append(name, el('td', quoteNumber(quote?.close)), el('td', signedQuote(quote?.change), quoteDirection(quote?.change)), el('td', signedQuote(quote?.percent, '%'), quoteDirection(quote?.change))); body.append(tr);
    }); table.append(body); wrapper.append(table); stocks.content.append(wrapper, el('p', `${group.name} · 共 ${selected.length} 檔，顯示前 ${Math.min(selected.length, 5)} 檔；切換此選單僅影響首頁顯示。`, 'overview-caption'));
  };
  const rerenderStocks = snapshotCard(stocks, quotes, renderStocks, snapshot => `最近交易日：${snapshot.tradeDate} · 盤後收盤行情，非即時股價。`, snapshot => `交易日 ${snapshot.tradeDate} · 擷取 ${formatTime(snapshot.fetchedAt)}`);
  selector.addEventListener('change', () => { groupId = selector.value; rerenderStocks(); });

  const articles = card('news', '最新新聞', 'NEWS / 中央社 RSS', '中央通訊社', NEWS_RSS_PAGE);
  snapshotCard(articles, news, snapshot => {
    articles.content.replaceChildren(); const items = filterNews(snapshot?.articles ?? []).slice(0, 5);
    if (!items.length) { articles.content.append(el('p', '目前沒有可顯示的新聞。')); return; }
    const list = el('ul', '', 'overview-list'); items.forEach(article => {
      const item = el('li'); item.append(link(article.title, article.url, true), el('p', `${article.categories.map(key => NEWS_CATEGORIES[key]).join('／')} · ${formatTime(article.publishedAt)} · ${article.source}`, 'overview-caption')); list.append(item);
    }); articles.content.append(list);
  }, () => '依新聞發布時間由新到舊；點標題開啟中央社原文。');

  const quakes = card('earthquakes', '最近地震', 'EARTHQUAKES / 官方報告', '中央氣象署', EQ_SOURCE_URL);
  snapshotCard(quakes, earthquakes, snapshot => {
    quakes.content.replaceChildren(); const items = [...(snapshot?.events ?? [])].sort((a, b) => b.originTime.localeCompare(a.originTime)).slice(0, 3);
    if (!items.length) { quakes.content.append(el('p', '目前快照沒有地震紀錄。')); return; }
    const list = el('ul', '', 'overview-list'); items.forEach(event => {
      const item = el('li'); item.append(link(event.location, `#/earthquakes?event=${encodeURIComponent(event.id)}`), el('p', `${formatEarthquakeTime(event.originTime)} · 規模 ${event.magnitude ?? '未提供'} · 最大觀測震度 ${event.maxIntensity ?? '未提供'}`, 'overview-caption')); list.append(item);
    }); quakes.content.append(list);
  }, () => '目前已取得的官方紀錄，非即時地震預警。');

  function snapshotCard(view, store, paint, describe, dates = snapshot => `快照擷取：${formatTime(snapshot.fetchedAt)}`) {
    let snapshot = store.peek(), busy = false, error = '', readAt = null, generation = 0;
    const refresh = button('重新讀取快照', () => load(true)); view.actions.append(refresh);
    function render() {
      if (!alive) return;
      refresh.disabled = busy; view.node.setAttribute('aria-busy', String(busy));
      const stale = snapshot && now() - Date.parse(snapshot.fetchedAt) > 86400000;
      view.status.textContent = `${busy ? '正在讀取快照… ' : ''}${snapshot ? describe(snapshot) : '尚無有效快照。'}${stale ? ' 快照已超過 24 小時，可能過期。' : ''}`;
      view.error.hidden = !error; view.error.textContent = error;
      view.metadata.textContent = `${snapshot ? dates(snapshot) : '擷取時間尚無資料'}${readAt ? ` · 網頁讀取：${formatTime(new Date(readAt).toISOString())}` : ''}`;
      paint(snapshot);
    }
    async function load(force = false) {
      const token = ++generation; busy = true; error = ''; render();
      try { const result = await store.load({ force }); if (!alive || token !== generation) return; snapshot = result.data; readAt = result.readAt; }
      catch (failure) { if (alive && token === generation) error = `${failure.message || '快照讀取失敗'}；既有有效資料與個人設定均保留。`; }
      finally { if (alive && token === generation) { busy = false; render(); } }
    }
    if (store === news || store === earthquakes) jobs.push(startAutoRefresh([{ interval: 5 * 60000, run: () => load(true) }]));
    jobs.push(() => { generation++; }); load(); return render;
  }
  return { updateWeather, updateAirQuality, dispose() { alive = false; jobs.forEach(cancel => cancel()); } };
}

import { NEWS_CATEGORIES, NEWS_RSS_PAGE, newsStore, filterNews, isNewsStale } from '../services/news.js';
import { loadNewsFavorites, toggleNewsFavorite } from '../services/news-favorites.js';
import { formatTime } from '../lib/format.js';

const node = (tag, text = '', className = '') => { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; };
function button(text, action, label = text) { const element = node('button', text, 'news-button'); element.type = 'button'; element.setAttribute('aria-label', label); element.addEventListener('click', action); return element; }
export function mountNews(host, { store = newsStore, storage, now = Date.now } = {}) {
  let favorites = loadNewsFavorites(storage), snapshot = store.peek(), loading = false, error = '', alive = true, request = 0;
  let category = 'all', query = '', order = 'newest', onlySaved = false, page = 0, readAt = null, cached = false;
  const size = 12;
  const shell = node('div', '', 'news-page');
  const statusCard = node('section', '', 'card news-status-card'); statusCard.setAttribute('aria-label', '新聞資料狀態');
  const eyebrow = node('span', 'CNA / NEWS DIGEST', 'eyebrow');
  const status = node('div'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const failure = node('p', '', 'news-error'); failure.setAttribute('role', 'alert');
  const refresh = button('重新讀取快照', () => load(true));
  const source = node('a', '中央通訊社 RSS／使用規範'); source.href = NEWS_RSS_PAGE; source.target = '_blank'; source.rel = 'noopener noreferrer';
  statusCard.append(eyebrow, status, failure, refresh, node('p', '此按鈕只讀取網站已發布的 JSON 快照，不會更新外部 RSS。快照需維護者執行更新腳本並重新發布；共用快取 5 分鐘，手動讀取間隔至少 10 秒。', 'news-help'), source);
  const tools = node('section', '', 'card news-tools'); tools.setAttribute('aria-label', '搜尋及篩選新聞');
  const searchLabel = node('label', '搜尋標題或關鍵字', 'news-search-field');
  const search = node('input'); search.type = 'search'; search.maxLength = 100; search.placeholder = '搜尋新聞標題或 RSS 前言'; searchLabel.append(search);
  const clear = button('清空搜尋', () => { query = ''; search.value = ''; page = 0; renderResults(); search.focus(); });
  const sortLabel = node('label', '發布時間排序', 'news-search-field');
  const sort = node('select'); sort.add(new Option('最新優先', 'newest')); sort.add(new Option('最舊優先', 'oldest')); sortLabel.append(sort);
  const savedLabel = node('label', '', 'news-saved-filter'); const saved = node('input'); saved.type = 'checkbox'; savedLabel.append(saved, document.createTextNode('只看收藏'));
  const toolbar = node('div', '', 'news-toolbar'); toolbar.append(searchLabel, clear, sortLabel, savedLabel);
  const categories = node('div', '', 'news-category-tabs'); categories.setAttribute('role', 'group'); categories.setAttribute('aria-label', '新聞分類');
  for (const [key, text] of Object.entries({ all: '全部', ...NEWS_CATEGORIES })) {
    const tab = button(text, () => { category = key; page = 0; renderResults(); }); tab.dataset.category = key; categories.append(tab);
  }
  const favoriteError = node('p', '', 'news-error'); favoriteError.setAttribute('role', 'alert');
  const retryFavorites = button('重新讀取收藏', () => { favorites = loadNewsFavorites(storage); favoriteError.textContent = favorites.error; renderResults(); });
  const message = node('p', '', 'news-feedback'); message.setAttribute('role', 'status');
  tools.append(toolbar, categories, favoriteError, retryFavorites, message);
  const count = node('p', '', 'news-result-count'); count.setAttribute('role', 'status');
  const results = node('div', '', 'news-grid'); results.setAttribute('aria-label', '新聞列表');
  const pagination = node('nav', '', 'news-pagination'); pagination.setAttribute('aria-label', '新聞分頁');
  shell.append(statusCard, tools, count, results, pagination); host.replaceChildren(shell);
  search.addEventListener('input', () => { query = search.value; page = 0; renderResults(); });
  sort.addEventListener('change', () => { order = sort.value; page = 0; renderResults(); });
  saved.addEventListener('change', () => { onlySaved = saved.checked; page = 0; renderResults(); });
  function renderStatus() {
    status.replaceChildren(); refresh.disabled = loading; refresh.textContent = loading ? '讀取中…' : '重新讀取快照';
    if (loading) status.append(node('p', '正在讀取新聞快照…'));
    if (snapshot) {
      status.append(node('p', `${snapshot.articles.length} 則新聞 · 來源：中央通訊社`, 'news-status-title'), node('p', `資料擷取時間：${formatTime(snapshot.fetchedAt)}（臺灣時間）`, 'news-help'));
      if (isNewsStale(snapshot, now())) status.append(node('p', '快照已超過 24 小時，可能過期；請依新聞發布時間判讀，需維護者更新及發布。', 'news-stale'));
      if (readAt !== null) status.append(node('p', `網頁讀取時間：${formatTime(new Date(readAt).toISOString())}${cached ? ' · 共用快取' : ''}`, 'news-help'));
    }
    failure.textContent = error;
  }
  function toggle(item) {
    if (favorites.locked) return;
    const existed = favorites.data.articles.some(article => article.id === item.id);
    try {
      const next = toggleNewsFavorite(favorites.data, item, storage); favorites = { data: next, locked: false, error: '' };
      message.textContent = existed ? '已取消收藏。' : '已收藏，重新開啟仍會保留。'; favoriteError.textContent = ''; renderResults();
      const replacement = [...results.querySelectorAll('button')].find(element => element.dataset.id === item.id);
      (replacement ?? saved).focus();
    } catch (error) { favoriteError.textContent = error.message; }
  }
  function renderResults() {
    categories.querySelectorAll('button').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.category === category)));
    if (favorites.locked) favoriteError.textContent = favorites.error;
    retryFavorites.hidden = !favorites.locked;
    const current = new Map(snapshot?.articles.map(article => [article.id, article]) ?? []);
    const list = onlySaved ? favorites.data.articles.map(article => current.get(article.id) ?? article) : snapshot?.articles ?? [];
    const filtered = filterNews(list, { category, query, order });
    const pages = Math.max(1, Math.ceil(filtered.length / size)); page = Math.min(page, pages - 1);
    count.textContent = `${onlySaved ? '收藏' : '新聞'} ${filtered.length} 則 · ${category === 'all' ? '全部分類' : NEWS_CATEGORIES[category]} · 第 ${page + 1} / ${pages} 頁`;
    results.replaceChildren(); pagination.replaceChildren();
    if (!filtered.length) {
      const empty = node('div', '', 'card news-empty'); empty.append(node('h2', loading ? '正在載入新聞' : query.trim() || category !== 'all' ? '找不到符合條件的新聞' : onlySaved ? favorites.locked ? '收藏暫時無法讀取' : '還沒有收藏新聞' : '目前沒有可顯示的新聞'), node('p', onlySaved ? '可在新聞卡片按「收藏」。收藏獨立保存在此瀏覽器，不會因新聞更新失敗被清除。' : '請調整分類／關鍵字，或重新讀取網站快照。', 'news-help')); results.append(empty);
    }
    const ids = new Set(favorites.data.articles.map(article => article.id));
    for (const item of filtered.slice(page * size, (page + 1) * size)) {
      const card = node('article', '', 'card news-card'), meta = node('div', '', 'news-meta');
      meta.append(node('span', item.categories.map(c => NEWS_CATEGORIES[c]).join('・'), 'badge'), node('span', item.source));
      const title = node('h2'); const link = node('a', item.title); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; title.append(link);
      const time = node('time', `發布：${formatTime(item.publishedAt)}（臺灣時間）`); time.dateTime = item.publishedAt;
      const summary = node('p', item.summary || '此 RSS 未提供前言，請閱讀原文。', 'news-summary');
      const footer = node('div', '', 'news-card-footer'), open = node('a', '閱讀中央社原文 ↗'); open.href = item.url; open.target = '_blank'; open.rel = 'noopener noreferrer';
      const favorite = button(ids.has(item.id) ? '★ 已收藏' : '☆ 收藏', () => toggle(item), `${ids.has(item.id) ? '取消收藏' : '收藏'}：${item.title}`);
      favorite.dataset.id = item.id; favorite.disabled = favorites.locked; favorite.setAttribute('aria-pressed', String(ids.has(item.id))); footer.append(open, favorite);
      card.append(meta, title, time, summary, node('p', `RSS 擷取：${formatTime(item.fetchedAt)}（臺灣時間）`, 'news-help'));
      if (onlySaved) card.append(node('p', '收藏保留 RSS 標題與前言；內容可能已更新，請以原文為準。', 'news-help'));
      card.append(footer); results.append(card);
    }
    if (pages > 1) {
      const previous = button('上一頁', () => { page--; renderResults(); }), next = button('下一頁', () => { page++; renderResults(); });
      previous.disabled = page === 0; next.disabled = page === pages - 1; pagination.append(previous, node('span', `${page + 1} / ${pages}`), next);
    }
  }
  async function load(force = false) {
    const token = ++request; loading = true; error = ''; renderStatus(); renderResults();
    try { const result = await store.load({ force }); if (!alive || token !== request) return; snapshot = result.data; readAt = result.readAt; cached = result.cached; }
    catch (failure) { if (!alive || token !== request) return; error = `${failure.message} 原有收藏與已載入新聞均保留。`; }
    finally { if (alive && token === request) { loading = false; renderStatus(); renderResults(); } }
  }
  load();
  return () => { alive = false; request++; };
}

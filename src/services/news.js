export const NEWS_SOURCE = '中央通訊社';
export const NEWS_RSS_PAGE = 'https://www.cna.com.tw/about/rss.aspx';
export const NEWS_CATEGORIES = Object.freeze({ technology: '科技', finance: '財經', intworld: '國際', lifehealth: '生活', social: '社會' });
export const feedUrl = category => {
  if (!Object.hasOwn(NEWS_CATEGORIES, category)) throw new Error('未知新聞分類。');
  return `https://feeds.feedburner.com/rsscna/${category}`;
};
export function newsUrl(raw) {
  if (typeof raw !== 'string') throw new Error('新聞連結型別異常。');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'www.cna.com.tw' || url.port || url.username || url.password || !/^\/news\/[a-z]+\/\d{12}\.aspx$/.test(url.pathname) || url.search || url.hash) throw new Error('新聞連結不在允許的中央社原文範圍。');
  return url.href;
}
export function newsTime(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw) || !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString() !== raw || raw < '2000') throw new Error('新聞時間格式異常。');
  return raw;
}
function text(value, max, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error('新聞文字欄位異常。');
  return value;
}
export function validateArticle(item) {
  if (!item || item.source !== NEWS_SOURCE) throw new Error('新聞來源異常。');
  const url = newsUrl(item.url);
  if (item.id !== url || !Array.isArray(item.categories) || !item.categories.length || new Set(item.categories).size !== item.categories.length || !item.categories.every(c => Object.hasOwn(NEWS_CATEGORIES, c))) throw new Error('新聞識別碼或分類異常。');
  const publishedAt = newsTime(item.publishedAt), fetchedAt = newsTime(item.fetchedAt);
  if (Date.parse(publishedAt) > Date.parse(fetchedAt) + 300000) throw new Error('新聞發布時間晚於資料擷取時間。');
  return { id: url, url, title: text(item.title, 300), summary: text(item.summary, 3000, true), categories: [...item.categories], source: NEWS_SOURCE, publishedAt, fetchedAt };
}
export function validateNewsSnapshot(data) {
  if (!data || data.version !== 1 || data.source !== NEWS_SOURCE || data.sourceUrl !== NEWS_RSS_PAGE || !Array.isArray(data.articles) || !Array.isArray(data.feeds) || data.feeds.length !== 5) throw new Error('新聞快照格式異常。');
  const fetchedAt = newsTime(data.fetchedAt), seen = new Set();
  const feeds = data.feeds.map(feed => {
    if (!feed || feed.url !== feedUrl(feed.category) || seen.has(feed.category) || !Number.isSafeInteger(feed.count) || feed.count < 0 || !/^[a-f0-9]{64}$/.test(feed.sha256)) throw new Error('RSS 來源紀錄異常。');
    seen.add(feed.category);
    if (newsTime(feed.fetchedAt) > fetchedAt) throw new Error('RSS 擷取時間異常。');
    return { ...feed };
  });
  const ids = new Set();
  const articles = data.articles.map(item => {
    const article = validateArticle(item);
    if (ids.has(article.id) || article.fetchedAt > fetchedAt) throw new Error('新聞快照重複或時間異常。');
    ids.add(article.id); return article;
  });
  if (feeds.reduce((sum, feed) => sum + feed.count, 0) < articles.length) throw new Error('新聞來源數量不一致。');
  return { version: 1, source: NEWS_SOURCE, sourceUrl: NEWS_RSS_PAGE, fetchedAt, feeds, articles };
}
const normalize = value => value.normalize('NFKC').toLocaleLowerCase('zh-TW').replaceAll('台', '臺').trim();
export function filterNews(articles, { category = 'all', query = '', order = 'newest' } = {}) {
  const terms = normalize(String(query)).split(/\s+/).filter(Boolean);
  return articles.filter(item => (category === 'all' || item.categories.includes(category)) && terms.every(term => normalize(`${item.title} ${item.summary}`).includes(term)))
    .sort((a, b) => (order === 'oldest' ? 1 : -1) * a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
}
export const isNewsStale = (snapshot, now = Date.now()) => now - Date.parse(snapshot.fetchedAt) > 86400000;
export async function fetchNewsSnapshot({ fetchImpl = (...args) => fetch(...args), timeout = 12000 } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(`${import.meta.env?.BASE_URL ?? '/'}data/news.json`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`新聞快照讀取失敗（HTTP ${response.status}）。`);
    return validateNewsSnapshot(await response.json());
  } catch (error) { throw new Error(error.name === 'AbortError' ? '新聞讀取逾時，請稍後重試。' : error.message || '新聞讀取失敗，請檢查網路。'); }
  finally { clearTimeout(timer); }
}
export function createNewsStore({ fetcher = fetchNewsSnapshot, now = Date.now } = {}) {
  let data = null, readAt = 0, attemptedAt = -Infinity, pending = null;
  return {
    peek: () => data,
    load({ force = false } = {}) {
      if (pending) return pending;
      if (data && ((!force && now() - readAt < 300000) || now() - attemptedAt < 10000)) return Promise.resolve({ data, readAt, cached: true });
      if (!data && now() - attemptedAt < 10000) return Promise.reject(new Error('請稍候 10 秒再讀取新聞。'));
      attemptedAt = now();
      pending = Promise.resolve().then(fetcher).then(next => {
        if (data && next.fetchedAt < data.fetchedAt) throw new Error('網站回傳較舊新聞快照，已保留原有資料。');
        data = next; readAt = now(); return { data, readAt, cached: false };
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}
export const newsStore = createNewsStore();

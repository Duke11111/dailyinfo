import { validateArticle } from './news.js';
export const NEWS_FAVORITES_KEY = 'dailyinfo.news.favorites.v1';
export function validateFavorites(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.articles)) throw new Error('收藏資料格式損壞；原始內容已保留。');
  const articles = data.articles.map(validateArticle);
  if (new Set(articles.map(item => item.id)).size !== articles.length) throw new Error('收藏資料包含重複新聞；原始內容已保留。');
  return { version: 1, articles };
}
export function loadNewsFavorites(storage) {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(NEWS_FAVORITES_KEY);
    return { data: raw === null ? { version: 1, articles: [] } : validateFavorites(JSON.parse(raw)), locked: false, error: '' };
  } catch { return { data: { version: 1, articles: [] }, locked: true, error: '無法讀取收藏或格式已損壞；原始內容未覆寫，請檢查瀏覽器儲存設定或還原備份後重新讀取收藏。' }; }
}
export function toggleNewsFavorite(data, article, storage) {
  const current = validateFavorites(data), safe = validateArticle(article);
  const next = { version: 1, articles: current.articles.some(item => item.id === safe.id) ? current.articles.filter(item => item.id !== safe.id) : [...current.articles, safe] };
  try { (storage ?? globalThis.localStorage).setItem(NEWS_FAVORITES_KEY, JSON.stringify(next)); }
  catch (error) { throw new Error(error.name === 'QuotaExceededError' ? '收藏儲存空間不足，這次操作未儲存；原有收藏保留。' : '無法儲存收藏，這次操作未儲存；原有收藏保留。'); }
  return next;
}

// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountNews } from '../src/pages/news.js';
import { NEWS_FAVORITES_KEY } from '../src/services/news-favorites.js';
import { applySettings } from '../src/services/settings.js';
import { article, newsFixture, fetchedAt } from './fixtures/news.js';
let dispose;
const settle = () => vi.waitFor(() => expect(document.querySelector('.news-status-title')).not.toBeNull());
const buttons = () => [...document.querySelectorAll('button')];
const click = name => { const target = buttons().find(b => b.textContent === name); expect(target).toBeTruthy(); target.click(); };
const boot = (overrides = {}) => {
  const store = { peek: () => null, load: vi.fn(async () => ({ data: newsFixture(), readAt: Date.parse(fetchedAt), cached: false })), ...overrides };
  dispose = mountNews(document.querySelector('#host'), { store, now: () => Date.parse(fetchedAt) }); return store;
};
beforeEach(() => { localStorage.clear(); document.body.innerHTML = '<div id="host"></div>'; });
afterEach(() => dispose?.());
it('shows source, categories, publication/fetch times and safe external article links', async () => {
  boot(); await settle(); expect(document.querySelectorAll('article')).toHaveLength(2);
  expect(document.querySelector('article').textContent).toContain('中央通訊社'); expect(document.querySelector('time').dateTime).toBe(article().publishedAt);
  expect(document.querySelector('article h2 a').rel).toContain('noopener'); expect(document.querySelector('article h2 a').target).toBe('_blank');
  expect(document.querySelector('.news-status-card').textContent).toContain('不會更新外部 RSS');
});
it('retains stale warnings and source times when filters hide all articles or refreshing fails', async () => {
  const store = { peek: () => null, load: vi.fn(async () => ({ data: newsFixture(), readAt: Date.parse(fetchedAt) })) };
  dispose = mountNews(document.querySelector('#host'), { store, now: () => Date.parse(fetchedAt) + 25 * 3600000 });
  await settle();
  const status = document.querySelector('.news-status-card');
  expect(status.querySelector('.news-stale').textContent).toContain('可能過期');
  const input = document.querySelector('input[type="search"]'); input.value = '不存在的新聞'; input.dispatchEvent(new Event('input'));
  expect(document.querySelector('.news-empty')).not.toBeNull();
  expect(status.querySelector('.news-stale').hidden).toBe(false);
  expect(status.textContent).toContain('資料擷取時間');
  expect(status.querySelector('a').href).toBe('https://www.cna.com.tw/about/rss.aspx');
  store.load.mockRejectedValueOnce(Error('offline')); click('重新讀取快照');
  await vi.waitFor(() => expect(status.querySelector('[role="alert"]').textContent).toContain('offline'));
  expect(status.querySelector('.news-stale').textContent).toContain('可能過期');
  expect(status.textContent).toContain('中央通訊社');
});
it('filters categories/search, clears query, sorts and shows no results', async () => {
  boot(); await settle(); click('財經'); expect(document.querySelectorAll('article')).toHaveLength(1); click('全部');
  const input = document.querySelector('input[type=search]'); input.value = '不存在'; input.dispatchEvent(new Event('input'));
  expect(document.querySelector('.news-empty').textContent).toContain('找不到'); click('清空搜尋'); expect(input.value).toBe('');
  const select = document.querySelector('select'); select.value = 'oldest'; select.dispatchEvent(new Event('change')); expect(document.querySelector('article').textContent).toContain('財經市場');
});
it('saves/restores favorites, keeps archived news and cancels a favorite', async () => {
  boot(); await settle(); buttons().find(b => b.getAttribute('aria-label') === `收藏：${article().title}`).click();
  expect(JSON.parse(localStorage.getItem(NEWS_FAVORITES_KEY)).articles).toHaveLength(1); dispose();
  boot({ load: async () => ({ data: { ...newsFixture(), articles: [] }, readAt: Date.parse(fetchedAt) }) }); await settle();
  const saved = document.querySelector('input[type=checkbox]'); saved.checked = true; saved.dispatchEvent(new Event('change'));
  expect(document.querySelectorAll('article')).toHaveLength(1); expect(document.querySelector('article').textContent).toContain('內容可能已更新');
  buttons().find(b => b.getAttribute('aria-label') === `取消收藏：${article().title}`).click(); expect(document.querySelector('.news-empty').textContent).toContain('還沒有收藏');
});
it('keeps loaded news and saved favorites after refresh failure', async () => {
  const store = boot(); await settle(); buttons().find(b => b.getAttribute('aria-label') === `收藏：${article().title}`).click();
  const raw = localStorage.getItem(NEWS_FAVORITES_KEY); store.load.mockRejectedValueOnce(Error('offline')); click('重新讀取快照');
  await vi.waitFor(() => expect(document.querySelector('.news-status-card [role=alert]').textContent).toContain('offline'));
  expect(document.querySelectorAll('article')).toHaveLength(2); expect(localStorage.getItem(NEWS_FAVORITES_KEY)).toBe(raw);
});
it('shows initial failure while allowing saved news to remain usable', async () => {
  localStorage.setItem(NEWS_FAVORITES_KEY, JSON.stringify({ version: 1, articles: [article()] })); boot({ load: async () => { throw Error('offline'); } });
  await vi.waitFor(() => expect(document.querySelector('.news-error').textContent).toContain('offline'));
  const saved = document.querySelector('input[type=checkbox]'); saved.checked = true; saved.dispatchEvent(new Event('change')); expect(document.querySelectorAll('article')).toHaveLength(1);
});
it('shows loading, stale and empty states', async () => {
  let finish; boot({ load: () => new Promise(resolve => { finish = resolve; }) }); expect(document.querySelector('.news-status-card').textContent).toContain('正在讀取');
  finish({ data: { ...newsFixture(), fetchedAt: '2026-10-17T13:00:00.000Z', articles: [] }, readAt: Date.parse(fetchedAt) }); await settle();
  expect(document.querySelector('.news-stale').textContent).toContain('超過 24 小時'); expect(document.querySelector('.news-empty').textContent).toContain('目前沒有');
});
it('locks corrupt favorites and never executes dynamic HTML', async () => {
  localStorage.setItem(NEWS_FAVORITES_KEY, 'corrupt'); const data = newsFixture(); data.articles[0].title = '<img src=x onerror=alert(1)>'; data.articles[0].summary = '<script>evil()</script>';
  boot({ load: async () => ({ data, readAt: Date.parse(fetchedAt) }) }); await settle();
  expect(document.querySelector('article').textContent).toContain('<script>evil()</script>'); expect(document.querySelector('article img, article script')).toBeNull();
  expect(buttons().find(b => b.textContent === '☆ 收藏').disabled).toBe(true); expect(localStorage.getItem(NEWS_FAVORITES_KEY)).toBe('corrupt');
});
it('paginates all matching news and respects settings without changing existing storage', async () => {
  const data = newsFixture(); data.articles = Array.from({ length: 15 }, (_, i) => article({ id: `https://www.cna.com.tw/news/ait/20261019${String(i).padStart(4, '0')}.aspx`, url: `https://www.cna.com.tw/news/ait/20261019${String(i).padStart(4, '0')}.aspx` }));
  localStorage.setItem('dailyinfo.watchlists.v1', 'untouched'); applySettings({ mode: 'dark', accent: 'violet', fontSize: 'large' });
  boot({ load: async () => ({ data, readAt: Date.parse(fetchedAt) }) }); await settle(); expect(document.querySelectorAll('article')).toHaveLength(12); click('下一頁'); expect(document.querySelectorAll('article')).toHaveLength(3);
  expect(document.documentElement.dataset).toMatchObject({ theme: 'dark', accent: 'violet', fontSize: 'large' }); expect(localStorage.getItem('dailyinfo.watchlists.v1')).toBe('untouched');
});
it('ignores late responses after leaving the page', async () => {
  let finish; boot({ load: () => new Promise(resolve => { finish = resolve; }) }); dispose(); document.querySelector('#host').replaceChildren();
  finish({ data: newsFixture(), readAt: Date.parse(fetchedAt) }); await Promise.resolve(); expect(document.querySelector('#host').textContent).toBe('');
});

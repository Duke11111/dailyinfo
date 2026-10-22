// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountStocks } from '../src/pages/stocks.js';
import { applySettings } from '../src/services/settings.js';
import { WATCHLIST_KEY, loadWatchlists, emptyWatchlists, persistWatchlists, updateWatchlists } from '../src/services/watchlists.js';
import { catalogFixture } from './fixtures/stock-catalog.js';
let host, dispose;
const find = selector => host.querySelector(selector);
const click = text => { const btn = [...host.querySelectorAll('button')].find(b => b.textContent === text); expect(btn, text).toBeTruthy(); btn.click(); };
function input(selector, value) { const el = find(selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
function submitDialog(name) { if (name !== undefined) find('dialog input').value = name; find('dialog form').dispatchEvent(new Event('submit', { cancelable: true })); }
async function boot() { dispose = mountStocks(host); await vi.waitFor(() => expect(find('#stock-catalog-count').textContent).toContain('3 筆')); }
beforeEach(() => {
  document.body.innerHTML = '<div id="stock-test"></div>'; host = document.querySelector('#stock-test'); localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({ ok: true, json: async () => catalogFixture() })));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function () { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function () { this.open = false; this.onclose?.(); } });
});
afterEach(() => { dispose?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete HTMLDialogElement.prototype.showModal; delete HTMLDialogElement.prototype.close; });

it('creates and renames a group immediately and requires confirmation for deletion', async () => {
  await boot(); click('＋ 新增群組'); submitDialog('科技股');
  expect(find('#watchlist-title').textContent).toBe('科技股'); expect(find('dialog').open).toBe(false);
  click('重新命名'); submitDialog('長期投資'); expect(find('#watchlist-title').textContent).toBe('長期投資');
  click('刪除群組'); expect(loadWatchlists().data.groups).toHaveLength(2); click('取消'); expect(loadWatchlists().data.groups).toHaveLength(2);
  click('刪除群組'); submitDialog(); expect(loadWatchlists().data.groups).toHaveLength(1);
});
it('renders user names as text and shows invalid-name errors', async () => {
  await boot(); click('＋ 新增群組'); submitDialog(' '.repeat(3)); expect(find('dialog [role="alert"]').textContent).toContain('1–40');
  submitDialog('<img src=x onerror=alert(1)>'); expect(host.querySelector('img')).toBeNull(); expect(find('#watchlist-title').textContent).toContain('<img');
});
it('searches, adds once, clears and reports no results without fabricated prices', async () => {
  await boot(); input('#stock-search', '2330'); click('＋ 加入');
  expect(find('tbody tr').dataset.code).toBe('2330'); expect([...host.querySelectorAll('.stock-unavailable')].every(td => td.textContent === '暫無行情')).toBe(true);
  expect(find('.stock-results button[aria-label^="已加入"]').disabled).toBe(true); expect(loadWatchlists().data.groups[0].stocks).toHaveLength(1);
  click('清空搜尋'); expect(find('#stock-search').value).toBe(''); input('#stock-search', '不存在'); expect(find('#stock-search-results').textContent).toContain('查無');
});
it('copies/moves using a target selector and removes only the active membership', async () => {
  await boot(); input('#stock-search', '2330'); click('＋ 加入'); click('＋ 新增群組'); submitDialog('科技股');
  find('[data-group-id="default"]').click(); click('移轉'); find('dialog select[aria-label="目標群組"]').selectedIndex = 0; submitDialog();
  expect(loadWatchlists().data.groups.map(g => g.stocks.length)).toEqual([1, 1]);
  click('移轉'); find('dialog select[aria-label="移轉方式"]').value = 'move'; submitDialog();
  expect(find('dialog [role="alert"]').textContent).toContain('已包含'); expect(loadWatchlists().data.groups.map(g => g.stocks.length)).toEqual([1, 1]); click('取消');
  click('移除'); expect(loadWatchlists().data.groups.map(g => g.stocks.length)).toEqual([0, 1]);
});
it('restores persisted data after unmount/remount', async () => {
  await boot(); click('＋ 新增群組'); submitDialog('ETF'); input('#stock-search', '0050'); click('＋ 加入');
  dispose(); await boot(); expect(find('#watchlist-title').textContent).toBe('ETF'); expect(find('tbody').textContent).toContain('元大台灣50');
});
it('keeps previous UI and storage when quota is exceeded', async () => {
  await boot(); persistWatchlists(emptyWatchlists()); const raw = localStorage.getItem(WATCHLIST_KEY);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  click('＋ 新增群組'); submitDialog('未存入'); expect(find('dialog').open).toBe(true); expect(find('#watchlist-title').textContent).toBe('我的自選'); expect(find('#stocks-notice').textContent).toContain('容量不足'); expect(localStorage.getItem(WATCHLIST_KEY)).toBe(raw);
});
it('preserves watchlists on API failure and allows retry', async () => {
  const data = updateWatchlists(emptyWatchlists(), { type: 'add', stock: catalogFixture().stocks[0] }); persistWatchlists(data);
  fetch.mockRejectedValueOnce(Error('offline')); dispose = mountStocks(host);
  await vi.waitFor(() => expect(find('.stock-search-error')).not.toBeNull()); expect(find('tbody').textContent).toContain('台積電');
  click('重新載入目錄'); await vi.waitFor(() => expect(find('#stock-catalog-count').textContent).toContain('3 筆')); expect(loadWatchlists().data).toEqual(data);
});
it('locks corrupted storage until explicit reset confirmation', async () => {
  localStorage.setItem(WATCHLIST_KEY, '{broken'); await boot(); expect(find('#new-stock-group').disabled).toBe(true);
  click('重設自選資料'); expect(localStorage.getItem(WATCHLIST_KEY)).toBe('{broken'); click('取消'); expect(localStorage.getItem(WATCHLIST_KEY)).toBe('{broken');
  click('重設自選資料'); submitDialog(); expect(find('#new-stock-group').disabled).toBe(false); expect(loadWatchlists().locked).toBe(false);
});
it('inherits all global modes, colors and font sizes without changing stored groups', async () => {
  await boot(); const original = loadWatchlists().data;
  for (const mode of ['light', 'dark', 'system']) for (const accent of ['teal', 'blue', 'violet', 'rose', 'amber']) for (const fontSize of ['small', 'standard', 'large']) {
    applySettings({ mode, accent, fontSize }, document.documentElement, true);
    expect(document.documentElement.dataset).toMatchObject({ theme: mode === 'system' ? 'dark' : mode, accent, fontSize });
    expect(find('#stock-search')).not.toBeNull(); expect(loadWatchlists().data).toEqual(original);
  }
});
it('paginates every matching result rather than truncating the catalog', async () => {
  const catalog = catalogFixture();
  catalog.stocks = Array.from({ length: 45 }, (_, i) => ({ code: String(1000 + i), name: `測試公司 ${i}`, fullName: `測試公司 ${i} 股份有限公司`, type: 'stock' }));
  catalog.stocks.push(catalogFixture().stocks[2]); catalog.sources[0].count = 45;
  fetch.mockResolvedValue({ ok: true, json: async () => catalog }); dispose = mountStocks(host);
  await vi.waitFor(() => expect(find('#stock-catalog-count').textContent).toContain('46 筆'));
  input('#stock-search', '測試'); expect(host.querySelectorAll('.stock-results li')).toHaveLength(20);
  click('下一頁'); expect(find('.stock-results').textContent).toContain('1020');
  click('下一頁'); expect(host.querySelectorAll('.stock-results li')).toHaveLength(5);
  expect([...host.querySelectorAll('button')].find(b => b.textContent === '下一頁').disabled).toBe(true);
});

// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountStocks } from '../src/pages/stocks.js';
import { catalogFixture } from './fixtures/stock-catalog.js';
import { quoteFixture } from './fixtures/quotes.js';
import { WATCHLIST_KEY, loadWatchlists } from '../src/services/watchlists.js';
import { applySettings } from '../src/services/settings.js';
let dispose, host;
const click = label => [...host.querySelectorAll('button')].find(node => node.textContent === label).click();
const input = value => { const node = host.querySelector('#stock-search'); node.value = value; node.dispatchEvent(new Event('input')); };
async function boot(snapshot = quoteFixture()) {
  const quotes = { peek: () => null, load: vi.fn(async () => ({ data: snapshot })) };
  dispose = mountStocks(host, { quotes });
  await vi.waitFor(() => expect(host.querySelectorAll('.stock-exploration tbody tr')).toHaveLength(2)); return quotes;
}
beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'; host = document.querySelector('#host'); localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => catalogFixture() })));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; this.dispatchEvent(new Event('close')); } });
});
afterEach(() => { dispose?.(); vi.unstubAllGlobals(); delete HTMLDialogElement.prototype.showModal; delete HTMLDialogElement.prototype.close; });
it('shows default exploration and date, switches to search, then restores selected exploration tab', async () => {
  const quotes = await boot(); expect(host.querySelector('.stock-exploration').textContent).toContain('2026-10-16');
  expect(host.querySelector('.stock-exploration tbody tr').dataset.code).toBe('0050');
  click('漲幅排行榜'); input('2330'); expect(host.querySelector('.stock-exploration')).toBeNull(); expect(host.querySelectorAll('.stock-results li')).toHaveLength(1);
  click('清空搜尋'); expect(host.querySelector('[data-exploration-mode="gain"]').getAttribute('aria-pressed')).toBe('true'); expect(quotes.load).toHaveBeenCalledTimes(1);
});
it('honors product filtering in all exploration modes and subsequent searches', async () => {
  await boot(); const type = host.querySelector('#stock-type'); type.value = 'etf'; type.dispatchEvent(new Event('change'));
  for (const label of ['成交量排行榜', '漲幅排行榜', '常見關注']) { click(label); expect(host.querySelectorAll('.stock-exploration tbody tr')).toHaveLength(1); expect(host.querySelector('.stock-exploration tbody tr').dataset.code).toBe('0050'); }
  input('2330'); expect(host.querySelector('#stock-search-results').textContent).toContain('查無'); click('清空搜尋'); expect(host.querySelector('.stock-exploration tbody tr').dataset.code).toBe('0050');
});
it.each(['2330', '0050'])('opens existing details and history controls for %s without auto-loading history', async code => {
  await boot(); host.querySelector(`.stock-exploration tr[data-code="${code}"] .stock-detail-link`).click();
  const dialog = host.querySelector('.stock-detail-dialog'); expect(dialog.open).toBe(true); expect(dialog.textContent).toContain(code); expect(dialog.textContent).toContain('2026-10-16'); expect(dialog.textContent).toContain('載入真實歷史價格');
  expect(fetch).toHaveBeenCalledTimes(1); click('關閉詳細資訊');
});
it('uses existing group add operation and duplicate protection', async () => {
  await boot(); const raw = localStorage.getItem(WATCHLIST_KEY); expect(raw).toBeNull(); host.querySelector('.stock-exploration tr[data-code="2330"] button[aria-label^="加入"]').click();
  expect(loadWatchlists().data.groups[0].stocks.map(item => item.code)).toEqual(['2330']); expect(host.querySelector('.stock-exploration tr[data-code="2330"] button[aria-label^="已加入"]').disabled).toBe(true);
});
it('shows common products without invented quotes and safe external text', async () => {
  const catalog = catalogFixture(); catalog.stocks[1].name = '<img src=x onerror=alert(1)>'; fetch.mockResolvedValue({ ok: true, json: async () => catalog }); await boot(); click('常見關注');
  const missing = host.querySelector('.stock-exploration tr[data-code="2317"]'); expect(missing.textContent).toContain('暫無行情'); expect(missing.textContent).toContain('<img'); expect(host.querySelector('img')).toBeNull();
});
it('keeps exploration and groups when a manual quote reload fails', async () => {
  const quotes = await boot(); const raw = localStorage.getItem(WATCHLIST_KEY); quotes.load.mockRejectedValueOnce(Error('offline')); host.querySelector('#quote-refresh').click();
  await vi.waitFor(() => expect(host.querySelector('.stock-exploration').textContent).toContain('offline')); expect(host.querySelectorAll('.stock-exploration tbody tr')).toHaveLength(2); expect(localStorage.getItem(WATCHLIST_KEY)).toBe(raw);
});
it('inherits global dark mode, all accents and font sizes without writes', async () => {
  await boot(); const original = { ...localStorage };
  for (const accent of ['teal', 'blue', 'violet', 'rose', 'amber']) for (const fontSize of ['small', 'standard', 'large']) { applySettings({ mode: 'dark', accent, fontSize }); expect(document.documentElement.dataset).toMatchObject({ theme: 'dark', accent, fontSize }); expect(host.querySelector('.stock-exploration')).not.toBeNull(); }
  expect({ ...localStorage }).toEqual(original);
});
it('explains unavailable trusted volume instead of showing a fabricated ranking', async () => {
  const snapshot = quoteFixture(); snapshot.quotes.forEach(quote => { quote.volume = null; });
  dispose = mountStocks(host, { quotes: { peek: () => null, load: async () => ({ data: snapshot }) } });
  await vi.waitFor(() => expect(host.querySelector('.stock-exploration')?.textContent).toContain('沒有符合條件的可信排行資料'));
  expect(host.querySelectorAll('.stock-exploration tbody tr')).toHaveLength(0); click('常見關注'); expect(host.querySelectorAll('.stock-exploration tbody tr')).toHaveLength(3);
});
it('keeps catalog common browsing usable when the quote snapshot cannot be loaded', async () => {
  dispose = mountStocks(host, { quotes: { peek: () => null, load: async () => { throw Error('行情離線'); } } });
  await vi.waitFor(() => expect(host.querySelector('.stock-exploration')?.textContent).toContain('行情離線')); click('常見關注');
  expect(host.querySelectorAll('.stock-exploration tbody tr')).toHaveLength(3); expect(host.querySelector('.stock-exploration tbody').textContent).toContain('暫無行情'); expect(localStorage.getItem(WATCHLIST_KEY)).toBeNull();
});

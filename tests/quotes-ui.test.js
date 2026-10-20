// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountStocks } from '../src/pages/stocks.js';
import { openQuoteDetails, signedQuote } from '../src/components/quote-details.js';
import { persistWatchlists, emptyWatchlists, updateWatchlists, WATCHLIST_KEY } from '../src/services/watchlists.js';
import { applySettings } from '../src/services/settings.js';
import { quoteFixture } from './fixtures/quotes.js';
import { catalogFixture } from './fixtures/stock-catalog.js';

let host, dispose;
let service;
beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'; host = document.querySelector('#host'); localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function () { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function () { this.open = false; this.dispatchEvent(new Event('close')); } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => catalogFixture() }));
  service = { peek: () => null, load: vi.fn().mockResolvedValue({ data: quoteFixture(), readAt: Date.parse('2026-10-19T12:30:00Z'), cached: false }) };
});
afterEach(() => { dispose?.(); dispose = null; host.querySelectorAll('dialog').forEach(d => d.close()); vi.unstubAllGlobals(); delete HTMLDialogElement.prototype.showModal; delete HTMLDialogElement.prototype.close; });
function seed() {
  let data = emptyWatchlists();
  for (const quote of quoteFixture().quotes) data = updateWatchlists(data, { type: 'add', stock: { code: quote.code, name: quote.name, type: quote.code === '0050' ? 'etf' : 'stock' } });
  data = updateWatchlists(data, { type: 'create', name: '保留群組', id: 'retained' }); data = updateWatchlists(data, { type: 'select', groupId: 'default' }); persistWatchlists(data);
  return localStorage.getItem(WATCHLIST_KEY);
}
async function boot() { dispose = mountStocks(host, { quotes: service }); await vi.waitFor(() => expect(host.querySelector('#quote-status').textContent).toContain('2026-10-16')); }
it('shows real mapped prices, signed changes, share volume and trading date', async () => {
  seed(); await boot(); const row = host.querySelector('#watchlist-content tr[data-code="2330"]');
  expect(row.textContent).toContain('2,420.00'); expect(row.textContent).toContain('−20.00'); expect(row.textContent).toContain('−0.82%'); expect(row.textContent).toContain('43,046,982'); expect(row.textContent).toContain('2026-10-16');
  expect(host.querySelector('#watchlist-content tr[data-code="2454"]').textContent).toContain('+2.04%');
});
it('refreshes and sorts without altering any Phase 2A storage bytes', async () => {
  const raw = seed(); await boot();
  const select = host.querySelector('[aria-label="股票排序"]'); select.value = 'close'; select.dispatchEvent(new Event('change'));
  expect(host.querySelector('#watchlist-content tbody tr').dataset.code).toBe('2454'); expect(localStorage.getItem(WATCHLIST_KEY)).toBe(raw);
  host.querySelector('#quote-refresh').click(); await vi.waitFor(() => expect(service.load).toHaveBeenCalledWith({ force: true }));
  expect(localStorage.getItem(WATCHLIST_KEY)).toBe(raw);
  const custom = host.querySelector('[aria-label="股票排序"]'); custom.value = 'custom'; custom.dispatchEvent(new Event('change'));
  expect(host.querySelector('#watchlist-content tbody tr').dataset.code).toBe('2330'); expect(localStorage.getItem(WATCHLIST_KEY)).toBe(raw);
});
it('retains valid quote display and all groups if refresh fails', async () => {
  const raw = seed(); await boot(); service.load.mockRejectedValueOnce(Error('offline'));
  host.querySelector('#quote-refresh').click(); await vi.waitFor(() => expect(host.querySelector('#quote-status').textContent).toContain('保留上次有效行情'));
  expect(host.querySelector('#watchlist-content tr[data-code="2330"]').textContent).toContain('2,420.00'); expect(localStorage.getItem(WATCHLIST_KEY)).toBe(raw); expect(host.querySelector('.stock-group-tabs').textContent).toContain('保留群組');
});
it('shows unavailable quotes for an unreported code without deleting membership', async () => {
  const data = updateWatchlists(emptyWatchlists(), { type: 'add', stock: { code: '9999', name: '待查代號', type: 'stock' } }); persistWatchlists(data); const raw = localStorage.getItem(WATCHLIST_KEY);
  await boot(); expect(host.querySelector('#watchlist-content tbody').textContent).toContain('暫無行情'); expect(localStorage.getItem(WATCHLIST_KEY)).toBe(raw);
});
it('opens detailed OHLC/value/source with no HTML injection and readable signs', async () => {
  seed(); await boot(); host.querySelector('#watchlist-content tr[data-code="2330"] .stock-detail-link').click();
  const dialog = host.querySelector('.stock-detail-dialog'); expect(dialog.open).toBe(true); expect(dialog.textContent).toContain('最高價'); expect(dialog.textContent).toContain('2,445.00'); expect(dialog.textContent).toContain('104,583,063,462'); expect(dialog.querySelector('a').href).toContain('STOCK_DAY_ALL');
  expect(signedQuote(0, '%')).toBe('0.00%'); expect(signedQuote(null)).toBe('暫無行情');
  dialog.close();
  const injected = openQuoteDetails(host, { code: '9999', name: '<img src=x onerror=alert(1)>' }, null, null);
  expect(injected.querySelector('img')).toBeNull(); expect(injected.textContent).toContain('<img');
});
it('renders genuine historical points with explicit gaps and tabular values', async () => {
  const data = quoteFixture(), service = { load: vi.fn().mockResolvedValue({ start: '2026-09-16', end: '2026-10-16', points: [{ date: '2026-09-16', close: 2300 }, { date: '2026-09-17', close: null }, { date: '2026-10-16', close: 2420 }], warnings: ['部分月份缺值'], sources: ['https://www.twse.com.tw/exchangeReport/STOCK_DAY?stockNo=2330'], fetchedAt: data.fetchedAt }) };
  const dialog = openQuoteDetails(host, data.quotes[0], data.quotes[0], data, { historyService: service });
  dialog.querySelector('.quote-history button').click(); await vi.waitFor(() => expect(dialog.querySelector('svg')).not.toBeNull());
  expect(dialog.querySelectorAll('polyline')).toHaveLength(2); expect(dialog.querySelectorAll('circle')).toHaveLength(2); expect(dialog.textContent).toContain('資料不完整'); expect(dialog.textContent).toContain('2026-09-17：暫無行情');
});
it('does not update a dismissed history dialog after a slow response', async () => {
  let resolve; const historyService = { load: () => new Promise(done => { resolve = done; }) }, data = quoteFixture();
  const dialog = openQuoteDetails(host, data.quotes[0], data.quotes[0], data, { historyService }); dialog.querySelector('.quote-history button').click(); dialog.close();
  resolve({ points: [], warnings: [], sources: [], fetchedAt: data.fetchedAt }); await Promise.resolve(); expect(host.querySelector('.stock-detail-dialog')).toBeNull();
});
it('continues to use global themes and font sizes on the quote page', async () => {
  seed(); await boot();
  applySettings({ mode: 'dark', accent: 'rose', fontSize: 'large' }); expect(document.documentElement.dataset).toMatchObject({ theme: 'dark', accent: 'rose', fontSize: 'large' }); expect(host.querySelector('.quote-down').textContent).toContain('−');
});

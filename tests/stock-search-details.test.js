// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountStocks } from '../src/pages/stocks.js';
import { WATCHLIST_KEY, loadWatchlists } from '../src/services/watchlists.js';
import { catalogFixture } from './fixtures/stock-catalog.js';
import { quoteFixture } from './fixtures/quotes.js';

let host, dispose;
// Synthetic fixture only: production catalog and quote snapshots are never changed.
const etf = { code: '00919', name: '群益台灣精選高息', fullName: '群益台灣精選高息測試基金', type: 'etf' };
const quotes = () => {
  const snapshot = quoteFixture();
  snapshot.quotes.push({ ...snapshot.quotes.find(item => item.code === '0050'), code: etf.code, name: etf.name });
  return snapshot;
};
async function boot(snapshot = quotes()) {
  const catalog = catalogFixture(); catalog.stocks.push(etf); catalog.sources[1].count++;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => catalog })));
  dispose = mountStocks(host, { quotes: { peek: () => snapshot, load: vi.fn(async () => ({ data: snapshot })) } });
  await vi.waitFor(() => expect(host.querySelector('#stock-catalog-count').textContent).toContain('4 筆'));
  await vi.waitFor(() => expect(host.querySelector('#quote-refresh').disabled).toBe(false));
}
function search(value) { const input = host.querySelector('#stock-search'); input.value = value; input.dispatchEvent(new Event('input')); }
const detail = () => host.querySelector('.stock-detail-dialog');
function close() { [...detail().querySelectorAll('button')].find(button => button.textContent === '關閉詳細資訊').click(); }
beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'; host = document.querySelector('#host'); localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; this.dispatchEvent(new Event('close')); } });
});
afterEach(() => { dispose?.(); vi.unstubAllGlobals(); delete HTMLDialogElement.prototype.showModal; delete HTMLDialogElement.prototype.close; });

it.each(['00919', '2330'])('opens the existing details from both search code and name for %s with its own quote', async code => {
  const snapshot = quotes(); await boot(snapshot); search(code);
  const link = host.querySelector('.stock-result-link'), stock = code === '00919' ? etf : catalogFixture().stocks[0];
  expect(link.tagName).toBe('BUTTON'); expect(link.type).toBe('button');
  expect(link.getAttribute('aria-label')).toBe(`查看 ${code} ${stock.name} 詳細資訊`);
  for (const selector of ['.stock-code', '.stock-result-name']) {
    link.focus(); link.querySelector(selector).click();
    expect(detail().open).toBe(true); expect(detail().querySelector('h2').textContent).toBe(`${code} ${stock.name}`);
    const closeValue = [...detail().querySelectorAll('dl > div')].find(item => item.querySelector('dt').textContent === '收盤價').querySelector('dd').textContent;
    expect(closeValue).toBe(new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(snapshot.quotes.find(item => item.code === code).close));
    expect(detail().textContent).toContain(snapshot.tradeDate);
    close(); expect(document.activeElement).toBe(link);
  }
  expect(localStorage.getItem(WATCHLIST_KEY)).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
});
it('keeps viewing independent from adding and permits details when the added button is disabled', async () => {
  await boot(); search('00919');
  const row = host.querySelector('.stock-results li'); row.click(); row.querySelector('.badge').click();
  expect(detail()).toBeNull(); expect(loadWatchlists().data.groups[0].stocks).toHaveLength(0);
  row.querySelector('[aria-label^="加入"]').click();
  expect(loadWatchlists().data.groups[0].stocks.map(stock => stock.code)).toEqual(['00919']);
  const current = host.querySelector('.stock-results li'); expect(current.querySelector('[aria-label^="已加入"]').disabled).toBe(true);
  expect(current.querySelector('.stock-result-link').disabled).toBe(false);
  const raw = localStorage.getItem(WATCHLIST_KEY); current.querySelector('.stock-result-link').click();
  expect(detail().querySelector('h2').textContent).toBe('00919 群益台灣精選高息');
  expect(localStorage.getItem(WATCHLIST_KEY)).toBe(raw);
});
it('shows basic details without inventing a quote or loading history when the selected code is missing', async () => {
  await boot(quoteFixture()); search('00919'); host.querySelector('.stock-result-link').click();
  expect(detail().querySelector('h2').textContent).toBe('00919 群益台灣精選高息');
  expect([...detail().querySelectorAll('dd')].map(node => node.textContent)).toEqual(Array(8).fill('暫無行情'));
  expect(detail().textContent).toContain('官方此批行情未提供該代號');
  expect([...detail().querySelectorAll('button')].find(button => button.textContent === '載入真實歷史價格').disabled).toBe(true);
  expect(detail().querySelector('canvas')).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
});

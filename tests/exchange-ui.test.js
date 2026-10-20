// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountExchange, mountExchangeSummary } from '../src/pages/exchange.js';
import { mountOverview } from '../src/pages/overview.js';
import { exchangeFixture, exchangeCaptured, fullExchangeFixture } from './fixtures/exchange.js';
import { quoteFixture } from './fixtures/quotes.js';
import { newsFixture } from './fixtures/news.js';
import { eqFixture } from './fixtures/earthquakes.js';
import { DEFAULT_REGION } from '../src/services/regions.js';
import { applySettings } from '../src/services/settings.js';
let host, dispose;
const store = data => ({ peek: () => null, load: vi.fn(async () => ({ data, readAt: Date.parse(exchangeCaptured) })) });
async function boot(data = exchangeFixture()) { const service = store(data); dispose = mountExchange(host, { store: service, now: () => Date.parse(exchangeCaptured) }); await vi.waitFor(() => expect(host.querySelectorAll('tbody tr')).toHaveLength(data.rates.length)); return service; }
function change(label, value) { const input = host.querySelector(`[aria-label="${label}"]`); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); }
const amount = value => { const input = host.querySelector('input[inputmode="decimal"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
const click = label => [...host.querySelectorAll('button')].find(button => button.textContent === label).click();
beforeEach(() => { document.body.innerHTML = '<div id="host"></div>'; host = document.querySelector('#host'); localStorage.clear(); });
afterEach(() => { dispose?.(); });
it('discloses HTML-only verification rather than claiming CSV cross-checking', async () => {
  const data = fullExchangeFixture(); data.evidence = { mode: 'html-only', reason: 'csv_text_html', validation: 'official-table-19-v1', htmlSha256: 'a'.repeat(64) };
  await boot(data); expect(host.textContent).toContain('未進行 CSV 交叉核對');
  expect(host.textContent).toContain('19 種幣別與欄位完整性檢查');
});
it('shows independent bank columns and searches Chinese aliases / ISO codes', async () => {
  await boot(); const search = host.querySelector('input[type=search]'); search.value = '美元'; search.dispatchEvent(new Event('input')); expect(host.querySelectorAll('tbody tr')).toHaveLength(1); expect(host.querySelector('tbody').textContent).toContain('USD');
  change('查詢報價類型', 'cash'); expect(host.querySelectorAll('thead th')).toHaveLength(3); expect(host.querySelector('thead').textContent).not.toContain('即期'); click('清空幣別搜尋'); expect(host.querySelectorAll('tbody tr')).toHaveLength(4);
  search.value = 'not-a-currency'; search.dispatchEvent(new Event('input')); expect(host.textContent).toContain('查無符合');
});
it('switches common currencies and both conversion directions without network calls', async () => {
  const service = await boot(); click('JPY'); expect(host.querySelector('tbody').textContent).toContain('JPY'); expect(host.querySelector('[aria-label="換算外幣"]').value).toBe('JPY'); amount('1000'); expect(host.querySelector('output').textContent).toContain('4,761.904762');
  click('交換換算方向'); expect(host.querySelector('output').textContent).toContain('200.00 TWD'); expect(host.querySelector('output').textContent).toContain('銀行買入');
  change('換算報價類型', 'spot'); expect(host.querySelector('output').textContent).toContain('201.00 TWD'); expect(service.load).toHaveBeenCalledTimes(1);
});
it('handles zero, invalid / huge input and unavailable KRW spot without replacement quotes', async () => {
  await boot(); amount('0'); expect(host.querySelector('output strong').textContent).toContain('0.00'); amount('-1'); expect(host.querySelector('output').textContent).toContain('非負'); amount('1000000000001'); expect(host.querySelector('output').textContent).toContain('上限');
  amount('100'); change('換算外幣', 'KRW'); change('換算報價類型', 'spot'); expect(host.querySelector('output').textContent).toContain('未提供'); expect(host.querySelector('tr[data-currency=KRW]').textContent).toContain('未提供');
});
it('retains valid rates and user input after manual reload failure and labels stale snapshots', async () => {
  const service = await boot(); amount('123.45'); service.load.mockRejectedValueOnce(Error('offline')); click('重新讀取匯率快照');
  await vi.waitFor(() => expect(host.querySelector('[role=alert]').textContent).toContain('offline')); expect(host.querySelectorAll('tbody tr')).toHaveLength(4); expect(host.querySelector('input[inputmode=decimal]').value).toBe('123.45');
  dispose(); dispose = mountExchange(host, { store: store(exchangeFixture()), now: () => Date.parse(exchangeCaptured) + 3 * 86400000 }); await vi.waitFor(() => expect(host.textContent).toContain('可能過期'));
});
it('renders untrusted names safely and inherits all themes, accents and font sizes', async () => {
  const data = exchangeFixture(); data.rates[0].name = '<img src=x onerror=alert(1)>'; await boot(data); expect(host.querySelector('img')).toBeNull(); expect(host.textContent).toContain('<img');
  const original = { ...localStorage }; for (const mode of ['light', 'dark', 'system']) for (const accent of ['teal', 'blue', 'violet', 'rose', 'amber']) for (const fontSize of ['small', 'standard', 'large']) { applySettings({ mode, accent, fontSize }, document.documentElement, true); expect(host.querySelector('output')).not.toBeNull(); expect(document.documentElement.dataset.fontSize).toBe(fontSize); } expect({ ...localStorage }).toEqual(original);
});
it('renders only valid USD/JPY/EUR spot bank-sell quotes in a compact summary', async () => {
  const data = exchangeFixture(); data.rates[1].spot.sell = null; dispose = mountExchangeSummary(host, { store: store(data) });
  await vi.waitFor(() => expect(host.querySelectorAll('.exchange-mini-rates>span')).toHaveLength(2)); expect(host.textContent).toContain('即期銀行賣出'); expect(host.textContent).toContain('32.5'); expect(host.textContent).not.toContain('JPY/TWD'); expect(host.querySelector('a').getAttribute('href')).toBe('#/stocks?view=exchange');
});
it('does not let absent exchange snapshots remove existing stock or other overview content', async () => {
  const exchange = { peek: () => null, load: async () => { throw Error('missing'); } };
  const view = mountOverview(host, { exchange, weatherState: { region: DEFAULT_REGION, status: 'error', error: Error('weather unavailable') }, quotes: store(quoteFixture()), news: store(newsFixture()), earthquakes: store(eqFixture()), watchlists: { data: { activeId: 'test', sort: 'custom', groups: [{ id: 'test', name: '科技股', stocks: [{ code: '2330', name: '台積電', type: 'stock' }] }] }, problem: '' } }); dispose = () => view.dispose();
  await vi.waitFor(() => expect(host.querySelector('.exchange-mini').textContent).toContain('missing')); expect(host.querySelector('.overview-stocks tbody').textContent).toContain('2,420.00'); expect(host.querySelectorAll('.overview-card')).toHaveLength(4); expect(host.querySelector('.overview-news li')).not.toBeNull();
});
it('ignores late summary responses after leaving the route', async () => {
  let resolve; dispose = mountExchangeSummary(host, { store: { peek: () => null, load: () => new Promise(done => { resolve = done; }) } }); dispose(); const original = host.innerHTML; resolve({ data: exchangeFixture() }); await Promise.resolve(); expect(host.innerHTML).toBe(original);
});

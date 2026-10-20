import { exchangeStore, filterCurrencies, COMMON_CURRENCIES, convertExchange, exchangeNumber, exchangeAmount, isExchangeStale, EXCHANGE_SOURCE, EXCHANGE_LICENSE, EXCHANGE_POLICY } from '../services/exchange.js';
import { formatTime } from '../lib/format.js';
const el = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
function link(text, href, external = false) { const node = el('a', text); node.href = href; if (external) { node.target = '_blank'; node.rel = 'noopener noreferrer'; } return node; }
function button(text, action) { const node = el('button', text, 'stock-button'); node.type = 'button'; node.addEventListener('click', action); return node; }
function field(text, input) { const node = el('label', text, 'stock-field'); node.append(input); return node; }
function select(label, choices) { const node = el('select'); node.setAttribute('aria-label', label); choices.forEach(([value, text]) => node.add(new Option(text, value))); return node; }
function sourceLinks(host) { host.append(link('資料來源：臺灣銀行', EXCHANGE_SOURCE, true), document.createTextNode(' · '), link('政府資料開放授權條款第 1 版', EXCHANGE_LICENSE, true), document.createTextNode(' · '), link('臺銀資料開放宣告', EXCHANGE_POLICY, true)); }
export function mountExchange(host, { store = exchangeStore, now = Date.now } = {}) {
  let snapshot = store.peek(), alive = true, loading = false, failure = '', readAt = null, cached = false, request = 0;
  const shell = el('div', '', 'exchange-page'), statusCard = el('section', '', 'card exchange-status'); statusCard.setAttribute('aria-label', '外幣匯率資料狀態');
  statusCard.append(el('span', 'BANK OF TAIWAN / EXCHANGE', 'eyebrow'), el('h2', '外幣匯率查詢與換算'));
  const status = el('div'); status.setAttribute('role', 'status'); const error = el('p', '', 'stock-error'); error.setAttribute('role', 'alert');
  const refresh = button('重新讀取匯率快照', () => load(true));
  statusCard.append(status, error, refresh, el('p', '每 1 單位外幣折合多少新臺幣（TWD）。頁面只讀取網站已發布的快照，非即時更新銀行報價；銀行買入／賣出皆以銀行立場表示。', 'stock-help'));
  const sources = el('p', '', 'stock-sources'); sourceLinks(sources); statusCard.append(sources);
  const layout = el('div', '', 'exchange-layout'), lookup = el('section', '', 'card exchange-lookup'); lookup.setAttribute('aria-label', '幣別匯率搜尋'); lookup.append(el('h3', '牌告匯率'));
  const search = el('input'); search.type = 'search'; search.maxLength = 80; search.placeholder = '例如 USD、美元、日圓';
  const mode = select('查詢報價類型', [['all', '現金與即期'], ['cash', '現金匯率'], ['spot', '即期匯率']]);
  const filters = el('div', '', 'exchange-filters'); filters.append(field('搜尋幣別名稱或代碼', search), field('查詢報價類型', mode), button('清空幣別搜尋', () => { search.value = ''; renderTable(); search.focus(); })); lookup.append(filters);
  const shortcuts = el('div', '', 'exchange-shortcuts'); shortcuts.setAttribute('aria-label', '常用幣別'); lookup.append(shortcuts);
  const results = el('div'); results.setAttribute('aria-live', 'polite'); lookup.append(results);
  const calculator = el('section', '', 'card exchange-calculator'); calculator.setAttribute('aria-label', '幣值換算器'); calculator.append(el('h3', '幣值換算器'));
  const form = el('form'), amount = el('input'); amount.type = 'text'; amount.inputMode = 'decimal'; amount.maxLength = 30; amount.value = '1000';
  const currency = select('換算外幣', []), kind = select('換算報價類型', [['cash', '現金'], ['spot', '即期']]), direction = select('換算方向', [['toForeign', '新臺幣 → 外幣（銀行賣出）'], ['toTwd', '外幣 → 新臺幣（銀行買入）']]);
  form.append(field('輸入金額', amount), field('換算外幣', currency), field('換算報價類型', kind), field('換算方向', direction), button('交換換算方向', () => { direction.value = direction.value === 'toForeign' ? 'toTwd' : 'toForeign'; renderConversion(); }));
  const output = el('output', '', 'exchange-output'); output.setAttribute('aria-live', 'polite'); output.setAttribute('aria-label', '換算結果'); form.append(output); form.addEventListener('submit', event => event.preventDefault()); calculator.append(form, el('p', '依牌告匯率估算，非保證成交金額；不考慮來源未提供的手續費及其他交易成本。金額上限 1 兆、最多六位小數；結果四捨五入至六位小數，並非銀行結算規則。', 'stock-help'));
  form.addEventListener('input', renderConversion); form.addEventListener('change', renderConversion); search.addEventListener('input', renderTable); mode.addEventListener('change', renderTable);
  layout.append(lookup, calculator); shell.append(statusCard, layout); host.replaceChildren(shell);
  function renderStatus() {
    status.replaceChildren(); refresh.disabled = loading; statusCard.setAttribute('aria-busy', String(loading));
    if (loading) status.append(el('p', '正在讀取匯率快照…'));
    if (snapshot) {
      status.append(el('strong', `銀行牌告：${formatTime(snapshot.quotedAt)}（臺灣時間）`), el('p', `快照擷取：${formatTime(snapshot.fetchedAt)}${readAt ? ` · 網頁讀取：${formatTime(new Date(readAt).toISOString())}${cached ? '（共用快取）' : ''}` : ''}`, 'stock-help'));
      if (isExchangeStale(snapshot, now())) status.append(el('p', '牌告或快照已超過 24 小時，可能過期；請以標示時間為準。', 'stock-error'));
    } else status.append(el('p', '目前沒有有效匯率快照。', 'stock-help'));
    error.textContent = failure ? `${failure} 既有有效資料及個人設定均保留。` : '';
  }
  function renderTable() {
    results.replaceChildren();
    if (!snapshot) { results.append(el('p', loading ? '正在載入幣別…' : '無可用匯率資料，請重新讀取快照。', 'stock-help')); return; }
    let matches; try { matches = filterCurrencies(snapshot.rates, search.value); } catch (error) { results.append(el('p', error.message, 'stock-error')); return; }
    if (!matches.length) { results.append(el('p', '查無符合幣別；搜尋只涵蓋目前官方快照。', 'stock-help')); return; }
    const scroller = el('div', '', 'stock-table-scroll'); scroller.tabIndex = 0; scroller.setAttribute('aria-label', '匯率表格，可水平捲動');
    const table = el('table', '', 'stock-table exchange-table'); table.append(el('caption', `${matches.length} 種幣別 · 牌告 ${formatTime(snapshot.quotedAt)} · 報價單位 TWD／1 外幣`));
    const columns = [['現金買入', 'cash', 'buy'], ['現金賣出', 'cash', 'sell'], ['即期買入', 'spot', 'buy'], ['即期賣出', 'spot', 'sell']].filter(([, key]) => mode.value === 'all' || key === mode.value);
    const head = el('thead'), row = el('tr'); ['幣別／ISO 代碼', ...columns.map(([label]) => label)].forEach(text => { const th = el('th', text); th.scope = 'col'; row.append(th); }); head.append(row); table.append(head);
    const body = el('tbody'); matches.forEach(rate => { const row = el('tr'); row.dataset.currency = rate.code; row.append(el('td', `${rate.name} (${rate.code})`)); columns.forEach(([, mode, side]) => row.append(el('td', exchangeNumber(rate[mode][side]), 'quote-value'))); body.append(row); }); table.append(body); scroller.append(table); results.append(scroller, el('p', '「未提供」代表銀行未提供該項報價，不使用其他類型匯率替代。', 'stock-help'));
  }
  function renderCurrencies() {
    const previous = currency.value; currency.replaceChildren(); shortcuts.replaceChildren();
    for (const rate of snapshot?.rates ?? []) currency.add(new Option(`${rate.name} (${rate.code})`, rate.code));
    if (snapshot?.rates.some(rate => rate.code === previous)) currency.value = previous; else if (snapshot?.rates.some(rate => rate.code === 'USD')) currency.value = 'USD';
    COMMON_CURRENCIES.filter(code => snapshot?.rates.some(rate => rate.code === code)).forEach(code => shortcuts.append(button(code, () => { search.value = code; currency.value = code; renderTable(); renderConversion(); })));
  }
  function renderConversion() {
    output.replaceChildren();
    if (!snapshot) { output.append(el('p', '等待有效匯率資料。')); return; }
    try {
      const result = convertExchange(amount.value, snapshot.rates.find(rate => rate.code === currency.value), kind.value, direction.value);
      output.append(el('span', `${exchangeAmount(result.amount)} ${result.from} → ${result.to}`), el('strong', `${exchangeAmount(result.value)} ${result.to}`), el('p', `使用${kind.value === 'cash' ? '現金' : '即期'}銀行${result.side === 'buy' ? '買入' : '賣出'}：${exchangeNumber(result.rate)} TWD／1 ${currency.value}`), el('p', `${exchangeAmount(result.amount)} ${result.operator} ${exchangeNumber(result.rate)} = ${exchangeAmount(result.value)}`), el('small', `依牌告匯率估算 · ${formatTime(snapshot.quotedAt)}（臺灣時間）`));
    } catch (error) { output.append(el('p', error.message, 'stock-error')); }
  }
  async function load(force = false) {
    const token = ++request; loading = true; failure = ''; renderStatus(); renderTable();
    try { const result = await store.load({ force }); if (!alive || token !== request) return; snapshot = result.data; readAt = result.readAt; cached = result.cached; }
    catch (error) { if (alive && token === request) failure = error.message; }
    finally { if (alive && token === request) { loading = false; renderStatus(); renderCurrencies(); renderTable(); renderConversion(); } }
  }
  renderCurrencies(); renderConversion(); load(); return () => { alive = false; request++; };
}

export function mountExchangeSummary(host, { store = exchangeStore, now = Date.now } = {}) {
  let alive = true, snapshot = store.peek();
  function render(error = '') {
    host.replaceChildren(); host.className = 'exchange-mini';
    const heading = el('div', '', 'exchange-mini-heading'); heading.append(el('strong', '外匯 · 即期銀行賣出'), link('匯率與換算 →', '#/stocks?view=exchange')); host.append(heading);
    if (error) host.append(el('p', `匯率快照讀取失敗：${error}`, 'overview-caption'));
    if (!snapshot) { host.append(el('p', error ? '股票摘要仍可使用。' : '正在讀取匯率快照…', 'overview-caption')); return; }
    const quotes = ['USD', 'JPY', 'EUR'].map(code => snapshot.rates.find(rate => rate.code === code)).filter(rate => Number.isFinite(rate?.spot.sell));
    const list = el('div', '', 'exchange-mini-rates'); quotes.forEach(rate => { const item = el('span'); item.append(el('span', `${rate.code}/TWD`), el('b', exchangeNumber(rate.spot.sell))); list.append(item); }); host.append(list);
    host.append(el('p', `${quotes.length ? '每 1 外幣折合 TWD' : '目前無有效即期賣出報價'} · 牌告 ${formatTime(snapshot.quotedAt)}${isExchangeStale(snapshot, now()) ? ' · 可能過期' : ''} · 資料來源：臺灣銀行`, 'overview-caption'));
  }
  render(); store.load().then(result => { if (alive) { snapshot = result.data; render(); } }).catch(error => { if (alive) render(error.message); }); return () => { alive = false; };
}

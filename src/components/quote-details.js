import { QUOTE_SOURCE } from '../services/quotes.js';
import { stockHistory } from '../services/stock-history.js';
import { formatTime } from '../lib/format.js';

const el = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
export const quoteNumber = (number, integer = false) => Number.isFinite(number) ? new Intl.NumberFormat('zh-TW', integer ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number) : '暫無行情';
export const signedQuote = (number, suffix = '') => Number.isFinite(number) ? `${number > 0 ? '+' : number < 0 ? '−' : ''}${quoteNumber(Math.abs(number))}${suffix}` : '暫無行情';
export const quoteDirection = value => Number.isFinite(value) ? value > 0 ? 'quote-up' : value < 0 ? 'quote-down' : 'quote-flat' : '';

function renderHistory(container, history) {
  container.replaceChildren();
  if (history.warnings.length) container.append(el('p', `資料不完整：${history.warnings.join('；')}`, 'stock-error'));
  const valid = history.points.filter(point => point.close !== null);
  if (valid.length < 2) { container.append(el('p', '有效收盤資料不足，無法繪製走勢。')); return; }
  const width = 640, height = 230, left = 65, right = 18, top = 20, bottom = 38;
  const min = Math.min(...valid.map(p => p.close)), max = Math.max(...valid.map(p => p.close));
  const span = max - min || Math.max(1, max * .01), low = min - span * .1, high = max + span * .1;
  const x = date => left + (Date.parse(date) - Date.parse(history.start)) / (Date.parse(history.end) - Date.parse(history.start)) * (width - left - right);
  const y = price => height - bottom - (price - low) / (high - low) * (height - top - bottom);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `真實歷史收盤價，${history.start} 至 ${history.end}，${valid.length} 個交易日；缺值處斷線。`); svg.classList.add('stock-history-chart');
  const shape = (tag, attributes, text) => { const node = document.createElementNS(ns, tag); Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value)); if (text) node.textContent = text; svg.append(node); return node; };
  for (const price of [low, (low + high) / 2, high]) {
    shape('line', { x1: left, y1: y(price), x2: width - right, y2: y(price), class: 'history-grid' });
    shape('text', { x: left - 8, y: y(price) + 4, 'text-anchor': 'end' }, quoteNumber(price));
  }
  const segments = []; let segment = [];
  for (const point of history.points) {
    if (point.close === null) { if (segment.length) segments.push(segment); segment = []; }
    else segment.push(point);
  }
  if (segment.length) segments.push(segment);
  segments.forEach(points => shape('polyline', { points: points.map(p => `${x(p.date)},${y(p.close)}`).join(' '), fill: 'none', class: 'history-line' }));
  valid.forEach(point => { const circle = shape('circle', { cx: x(point.date), cy: y(point.close), r: 3, class: 'history-point' }); const title = document.createElementNS(ns, 'title'); title.textContent = `${point.date}：${quoteNumber(point.close)}`; circle.append(title); });
  for (const [date, anchor] of [[history.start, 'start'], [history.end, 'end']]) shape('text', { x: x(date), y: height - 10, 'text-anchor': anchor }, date.slice(5));
  container.append(svg, el('p', `${valid.length} 個有效交易日 · 非交易日不補值；來源缺值處斷線。日期範圍截至行情快照交易日，不混入較晚日期的價格。`, 'stock-help'));
  const table = el('details'); table.append(el('summary', '查看歷史價格與日期'));
  const list = el('ul'); history.points.forEach(p => list.append(el('li', `${p.date}：${quoteNumber(p.close)}`))); table.append(list); container.append(table);
  const source = el('a', '來源：TWSE 個股日成交資訊'); source.href = history.sources[0]; source.target = '_blank'; source.rel = 'noopener noreferrer'; container.append(source, el('p', `歷史資料取得時間：${formatTime(history.fetchedAt)}（臺灣時間）`, 'stock-help'));
}
export function openQuoteDetails(host, stock, quote, snapshot, { historyService = stockHistory } = {}) {
  const previous = document.activeElement, dialog = el('dialog', '', 'stock-dialog stock-detail-dialog');
  const title = el('h2', `${stock.code} ${quote?.name ?? stock.name}`); title.id = 'quote-detail-title'; dialog.setAttribute('aria-labelledby', title.id); dialog.append(title);
  dialog.append(el('p', `盤後行情 · 交易日期：${quote?.date ?? '暫無行情'} · 非即時股價`, 'stock-help'));
  const grid = el('dl', '', 'quote-detail-grid');
  for (const [label, value] of [['開盤價', quoteNumber(quote?.open)], ['最高價', quoteNumber(quote?.high)], ['最低價', quoteNumber(quote?.low)], ['收盤價', quoteNumber(quote?.close)], ['漲跌額', signedQuote(quote?.change)], ['漲跌幅', signedQuote(quote?.percent, '%')], ['成交量（股）', quoteNumber(quote?.volume, true)], ['成交金額（元）', quoteNumber(quote?.value, true)]]) {
    const item = el('div'); item.append(el('dt', label), el('dd', value, label.startsWith('漲跌') ? quoteDirection(quote?.change) : '')); grid.append(item);
  }
  dialog.append(grid, el('p', quote?.status ?? '官方此批行情未提供該代號；保留自選資料。', 'stock-help'));
  dialog.append(el('p', '漲跌幅＝漲跌額 ÷（收盤價 − 漲跌額）× 100%。參考價無效或特殊參考狀態不計算。', 'stock-help'));
  const link = el('a', '來源：TWSE STOCK_DAY_ALL'); link.href = QUOTE_SOURCE; link.target = '_blank'; link.rel = 'noopener noreferrer'; dialog.append(link);
  if (snapshot) dialog.append(el('p', `來源擷取時間：${formatTime(snapshot.fetchedAt)}（臺灣時間）`, 'stock-help'));
  const historyHost = el('section', '', 'quote-history'); historyHost.append(el('h3', '近一個月收盤走勢'));
  const historyResult = el('div'); historyResult.setAttribute('role', 'status');
  const load = el('button', '載入真實歷史價格', 'stock-button'); load.type = 'button'; load.disabled = !quote;
  load.addEventListener('click', async () => {
    load.disabled = true; historyResult.textContent = '正在向證交所讀取歷史資料…';
    try { const history = await historyService.load(stock.code, quote.date); if (dialog.open) renderHistory(historyResult, history); }
    catch (error) { if (dialog.open) historyResult.textContent = error.message; }
    finally { if (dialog.open) { load.disabled = false; load.textContent = '重新讀取歷史快取'; } }
  });
  historyHost.append(load, historyResult); dialog.append(historyHost);
  const close = el('button', '關閉詳細資訊', 'primary'); close.type = 'button'; close.addEventListener('click', () => dialog.close()); dialog.append(close);
  dialog.addEventListener('close', () => { dialog.remove(); if (previous?.isConnected) previous.focus(); });
  host.append(dialog); dialog.showModal(); return dialog;
}

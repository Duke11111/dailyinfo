import { mountHistoryChart, loadHistoryChart } from './stock-history-chart.js';
import { quoteSourceDetails } from '../services/quotes.js';
import { stockHistory } from '../services/stock-history.js';
import { formatTime } from '../lib/format.js';

const el = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
export const quoteNumber = (number, integer = false) => Number.isFinite(number) ? new Intl.NumberFormat('zh-TW', integer ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number) : '暫無行情';
export const signedQuote = (number, suffix = '') => Number.isFinite(number) ? `${number > 0 ? '+' : number < 0 ? '−' : ''}${quoteNumber(Math.abs(number))}${suffix}` : '暫無行情';
export const quoteDirection = value => Number.isFinite(value) ? value > 0 ? 'quote-up' : value < 0 ? 'quote-down' : 'quote-flat' : '';

export function openQuoteDetails(host, stock, quote, snapshot, { historyService = stockHistory, chartLoader = loadHistoryChart } = {}) {
  host.querySelectorAll('.stock-detail-dialog[open]').forEach(previous => previous.close());
  let disposeChart = () => {}, generation = 0;
  const previous = document.activeElement, dialog = el('dialog', '', 'stock-dialog stock-detail-dialog');
  const title = el('h2', `${stock.code} ${quote?.name ?? stock.name}`); title.id = 'quote-detail-title'; dialog.setAttribute('aria-labelledby', title.id); dialog.append(title);
  dialog.append(el('p', `盤後行情 · 交易日期：${quote?.date ?? '暫無行情'} · 非即時股價`, 'stock-help'));
  const grid = el('dl', '', 'quote-detail-grid');
  for (const [label, value] of [['開盤價', quoteNumber(quote?.open)], ['最高價', quoteNumber(quote?.high)], ['最低價', quoteNumber(quote?.low)], ['收盤價', quoteNumber(quote?.close)], ['漲跌額', signedQuote(quote?.change)], ['漲跌幅', signedQuote(quote?.percent, '%')], ['成交量（股）', quoteNumber(quote?.volume, true)], ['成交金額（元）', quoteNumber(quote?.value, true)]]) {
    const item = el('div'); item.append(el('dt', label), el('dd', value, label.startsWith('漲跌') ? quoteDirection(quote?.change) : '')); grid.append(item);
  }
  dialog.append(grid, el('p', quote?.status ?? '官方此批行情未提供該代號；保留自選資料。', 'stock-help'));
  dialog.append(el('p', '漲跌幅＝漲跌額 ÷（收盤價 − 漲跌額）× 100%。參考價無效或特殊參考狀態不計算。', 'stock-help'));
  const source = quoteSourceDetails(snapshot);
  const link = el('a', '來源：' + source.label); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; dialog.append(link);
  if (snapshot) dialog.append(el('p', `來源擷取時間：${formatTime(snapshot.fetchedAt)}（臺灣時間）`, 'stock-help'));
  const historyHost = el('section', '', 'quote-history'); historyHost.append(el('h3', '最近五個交易日收盤走勢'));
  const historyResult = el('div'); historyResult.setAttribute('role', 'status');
  const historyContent = el('div');
  const load = el('button', '載入真實歷史價格', 'stock-button'); load.type = 'button'; load.disabled = !quote;
  load.addEventListener('click', async () => {
    load.disabled = true; historyResult.textContent = '正在向證交所讀取歷史資料…';
    const token = ++generation;
    try {
      const history = await historyService.load(stock.code, quote.date);
      if (!dialog.open || token !== generation) return;
      const Chart = await chartLoader();
      if (!dialog.open || token !== generation) return;
      disposeChart(); disposeChart = () => {};
      disposeChart = mountHistoryChart(historyContent, history, { code: stock.code, name: quote.name ?? stock.name }, quote.date, Chart);
      historyResult.textContent = '';
    }
    catch (error) { if (dialog.open) historyResult.textContent = `${error.message}${historyContent.childNodes.length ? ' 保留最後有效歷史資料與原取得時間。' : ''}`; }
    finally { if (dialog.open) { load.disabled = false; load.textContent = '重新讀取歷史快取'; } }
  });
  historyHost.append(load, historyResult, historyContent); dialog.append(historyHost);
  const close = el('button', '關閉詳細資訊', 'primary'); close.type = 'button'; close.addEventListener('click', () => dialog.close()); dialog.append(close);
  dialog.addEventListener('close', () => { generation++; disposeChart(); dialog.remove(); if (previous?.isConnected) previous.focus(); });
  host.append(dialog); dialog.showModal(); return dialog;
}

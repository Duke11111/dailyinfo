import { parseTradingDate } from '../services/quotes.js';
import { formatTime } from '../lib/format.js';

const el = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const price = value => new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
export function recentTradingPoints(history, endDate) {
  const end = parseTradingDate(endDate), seen = new Set();
  return history.points.filter(point => {
    let date; try { date = parseTradingDate(point.date); } catch { return false; }
    if (date > end || date > history.end || date < history.start || seen.has(date)
      || [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())
      || !Number.isFinite(point.close) || point.close <= 0) return false;
    seen.add(date); return true;
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(-5);
}
export async function loadHistoryChart() {
  const { Chart, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip } = await import('chart.js');
  Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip);
  return Chart;
}
export function mountHistoryChart(container, history, stock, endDate, Chart) {
  const points = recentTradingPoints(history, endDate);
  const root = el('div');
  if (history.warnings.length) root.append(el('p', `資料不完整：${history.warnings.join('；')}`, 'stock-error'));
  const label = `${stock.code} ${stock.name} · 最近 ${points.length} 個有效交易日收盤價`;
  const summary = el('p', points.length ? `${label}；截至 ${endDate}。${points.length < 5 ? '資料不足五筆，僅顯示實際取得資料。' : ''}非交易日與缺值不補價，非即時股價。` : '尚無有效收盤資料，無法繪製走勢。', 'stock-help');
  root.append(summary);
  let chart, observer;
  if (points.length) {
    const frame = el('div', '', 'stock-history-frame'), canvas = el('canvas');
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', label);
    frame.append(canvas); root.append(frame);
    // Category dates are official trading dates, with no inferred holiday values or time adapter.
    chart = new Chart(canvas, {
      type: 'line', data: { labels: points.map(p => p.date), datasets: [{ label: `${stock.code} ${stock.name} 收盤價（元）`, data: points.map(p => p.close), tension: 0, borderWidth: 2, pointRadius: 4, pointHitRadius: 18, spanGaps: false }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: { tooltip: { enabled: true, callbacks: { label: context => `收盤價：${price(context.parsed.y)} 元` } } },
        scales: { x: { title: { display: true, text: '臺灣交易日期' }, ticks: { maxRotation: 0, autoSkip: true } },
          y: { title: { display: true, text: '收盤價（元）' }, ticks: {}, beginAtZero: false } } },
    });
    const theme = () => {
      const style = getComputedStyle(document.documentElement), font = { size: (parseFloat(style.fontSize) || 16) * .75, family: style.fontFamily };
      const color = style.getPropertyValue('--text-secondary').trim() || '#586575';
      const accent = style.getPropertyValue(document.documentElement.dataset.theme === 'dark' ? '--accent-light' : '--accent').trim() || '#197969';
      chart.data.datasets[0].borderColor = accent; chart.data.datasets[0].pointBackgroundColor = accent;
      for (const axis of Object.values(chart.options.scales)) {
        axis.ticks.color = color; axis.ticks.font = font; axis.title.color = color; axis.title.font = font;
        axis.grid = { color: style.getPropertyValue('--border').trim() || '#dbe2e8' };
      }
      chart.options.plugins.tooltip.bodyFont = font; chart.options.plugins.tooltip.titleFont = font;
      chart.update('none');
    };
    theme(); observer = new MutationObserver(theme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent', 'data-font-size'] });
  }
  const table = el('details'); table.append(el('summary', '查看歷史價格與日期'));
  const list = el('ul'); points.forEach(p => list.append(el('li', `${p.date}：${price(p.close)}`))); table.append(list); root.append(table);
  for (const url of history.sources) {
    let parsed; try { parsed = new URL(url); } catch { continue; }
    if (parsed.origin !== 'https://www.twse.com.tw' || parsed.pathname !== '/exchangeReport/STOCK_DAY') continue;
    const source = el('a', '來源：TWSE 個股日成交資訊'); source.href = url; source.target = '_blank'; source.rel = 'noopener noreferrer'; root.append(source);
  }
  root.append(el('p', `歷史資料取得時間：${formatTime(history.fetchedAt)}（臺灣時間）；重新讀取可能使用既有 30 分鐘快取。`, 'stock-help'));
  container.replaceChildren(root);
  return () => { observer?.disconnect(); chart?.destroy(); };
}

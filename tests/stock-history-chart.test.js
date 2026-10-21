// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { recentTradingPoints, mountHistoryChart } from '../src/components/stock-history-chart.js';
import { openQuoteDetails } from '../src/components/quote-details.js';
import { applySettings } from '../src/services/settings.js';
import { quoteFixture } from './fixtures/quotes.js';

const point = (date, close) => ({ date: `2026-10-${date}`, close });
const history = () => ({ start: '2026-09-16', end: '2026-10-16', points: [point('07', 100), point('08', 101), point('12', 103), point('13', null), point('14', 104), point('15', 105), point('16', 106), point('19', 999)], warnings: [], sources: ['https://www.twse.com.tw/exchangeReport/STOCK_DAY?stockNo=2330'], fetchedAt: '2026-10-20T00:00:00Z' });
let host, instances, disposers;
class FakeChart {
  constructor(canvas, config) { this.data = config.data; this.options = config.options; this.update = vi.fn(); this.destroy = vi.fn(); instances.push(this); }
}
const loader = async () => FakeChart;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); instances = []; disposers = [];
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
});
afterEach(() => {
  host.querySelectorAll('dialog').forEach(dialog => dialog.close()); disposers.forEach(dispose => dispose()); host.remove();
  delete HTMLDialogElement.prototype.showModal; delete HTMLDialogElement.prototype.close;
  document.documentElement.removeAttribute('style'); ['theme','accent','fontSize'].forEach(key => delete document.documentElement.dataset[key]);
});
it('chooses latest five valid closes ascending, omitting missing values without inventing holidays', () => {
  const value = history(); value.points.reverse();
  expect(recentTradingPoints(value, '2026-10-16')).toEqual([point('08',101), point('12',103), point('14',104), point('15',105), point('16',106)]);
});
it('excludes invalid prices/dates, duplicate days, weekends and dates past verified snapshot', () => {
  const value = history(); value.points.push(point('16',999), point('10',100), point('11',100), point('09',0), point('06',-1), point('05',NaN), { date: 'bad', close: 1 });
  expect(recentTradingPoints(value, '2026-10-15')).toEqual([point('07',100), point('08',101), point('12',103), point('14',104), point('15',105)]);
});
it.each([0,1,3])('renders actual %i available records and no artificial prices', count => {
  const value = history(); value.points = value.points.filter(p=>p.close!==null).slice(0,count);
  disposers.push(mountHistoryChart(host,value,{code:'2330',name:'台積電'},'2026-10-16',FakeChart));
  expect(host.querySelectorAll('li')).toHaveLength(count);
  if (count) { expect(host.textContent).toContain('資料不足五筆'); expect(instances[0].data.datasets[0].data).toEqual(value.points.map(p=>p.close)); }
  else { expect(host.textContent).toContain('尚無有效'); expect(instances).toHaveLength(0); }
});
it('labels the stock, official dates, exact prices, tooltip and source read time', () => {
  disposers.push(mountHistoryChart(host, history(), {code:'0050',name:'元大台灣50'},'2026-10-16',FakeChart));
  const chart = instances[0]; expect(chart.data.labels).toEqual(['2026-10-08','2026-10-12','2026-10-14','2026-10-15','2026-10-16']);
  expect(chart.data.datasets[0].label).toContain('0050 元大台灣50'); expect(chart.options.plugins.tooltip.callbacks.label({parsed:{y:104.25}})).toBe('收盤價：104.25 元');
  expect(host.querySelector('canvas').getAttribute('aria-label')).toContain('0050'); expect(host.textContent).toContain('歷史資料取得時間');
});
it('updates light/dark colors, accent and fonts and disconnects on cleanup', async () => {
  document.documentElement.style.setProperty('--accent','#112233'); document.documentElement.style.setProperty('--accent-light','#abcdef');
  const dispose = mountHistoryChart(host, history(), {code:'2330',name:'台積電'},'2026-10-16',FakeChart);
  const chart = instances[0]; expect(chart.data.datasets[0].borderColor).toBe('#112233');
  document.documentElement.style.fontSize = '20px'; applySettings({mode:'dark',accent:'rose',fontSize:'large'}); await Promise.resolve();
  expect(chart.data.datasets[0].borderColor).toBe('#abcdef'); expect(chart.options.scales.x.ticks.font.size).toBe(15);
  dispose(); const calls = chart.update.mock.calls.length; applySettings({mode:'light',accent:'teal',fontSize:'standard'}); await Promise.resolve();
  expect(chart.destroy).toHaveBeenCalledOnce(); expect(chart.update).toHaveBeenCalledTimes(calls);
});
const loadButton = dialog => dialog.querySelector('.quote-history button');
it('destroys old instance on refresh, stock switch, close and page disposal', async () => {
  const data = quoteFixture(), options = {historyService:{load:vi.fn(async()=>history())},chartLoader:loader};
  const first = openQuoteDetails(host,data.quotes[0],data.quotes[0],data,options);
  loadButton(first).click(); await vi.waitFor(()=>expect(instances).toHaveLength(1));
  loadButton(first).click(); await vi.waitFor(()=>expect(instances).toHaveLength(2)); expect(instances[0].destroy).toHaveBeenCalledOnce();
  const second = openQuoteDetails(host,data.quotes[1],data.quotes[1],data,options); expect(instances[1].destroy).toHaveBeenCalledOnce();
  loadButton(second).click(); await vi.waitFor(()=>expect(instances).toHaveLength(3)); expect(instances[2].data.datasets[0].label).toContain(data.quotes[1].code);
  second.close(); expect(instances[2].destroy).toHaveBeenCalledOnce();
});
it('retains last valid chart and timestamp if a later history query fails', async () => {
  const data = quoteFixture(), service = {load:vi.fn().mockResolvedValueOnce(history()).mockRejectedValueOnce(Error('連線失敗'))};
  const dialog = openQuoteDetails(host,data.quotes[0],data.quotes[0],data,{historyService:service,chartLoader:loader});
  loadButton(dialog).click(); await vi.waitFor(()=>expect(instances).toHaveLength(1)); loadButton(dialog).click();
  await vi.waitFor(()=>expect(dialog.textContent).toContain('保留最後有效')); expect(instances[0].destroy).not.toHaveBeenCalled(); expect(dialog.querySelector('canvas')).not.toBeNull();
});
it('never mounts a chart from a late response after closing the dialog', async () => {
  let resolve; const chartLoader = vi.fn(()=>new Promise(done=>{resolve=done;})), data=quoteFixture();
  const dialog = openQuoteDetails(host,data.quotes[0],data.quotes[0],data,{historyService:{load:async()=>history()},chartLoader});
  loadButton(dialog).click(); await vi.waitFor(()=>expect(chartLoader).toHaveBeenCalled()); dialog.close(); resolve(FakeChart);
  await Promise.resolve(); expect(instances).toHaveLength(0);
});
it('reports missing history without invoking chart code or generating demo prices', async () => {
  const data=quoteFixture(), chartLoader=vi.fn();
  const dialog=openQuoteDetails(host,data.quotes[0],data.quotes[0],data,{historyService:{load:async()=>{throw Error('API 失敗');}},chartLoader});
  loadButton(dialog).click(); await vi.waitFor(()=>expect(dialog.textContent).toContain('API 失敗')); expect(chartLoader).not.toHaveBeenCalled(); expect(dialog.querySelector('canvas')).toBeNull();
});

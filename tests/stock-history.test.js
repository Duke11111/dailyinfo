import { afterEach, it, expect, vi } from 'vitest';
import { createHistoryService, historyUrl, parseHistory } from '../src/services/stock-history.js';
const monthData = (month) => ({ stat: 'OK', fields: ['日期', '收盤價'], data: month === '2026-10' ? [['115/10/15', '2,440.00'], ['115/10/16', '2,420.00'], ['115/10/19', '2,420.00']] : [['115/09/16', '2,300.00'], ['115/09/17', '--']] });
afterEach(() => vi.useRealTimers());
it('uses the official monthly endpoint with leading-zero ETF codes', () => { expect(historyUrl('0050', '2026-10')).toContain('stockNo=0050'); expect(() => historyUrl('2330&bad', '2026-10')).toThrow(); });
it('parses ROC dates, preserves missing closes and rejects abnormal prices/dates', () => {
  expect(parseHistory(monthData('2026-09'), '2026-09')[1].close).toBeNull();
  expect(() => parseHistory({ stat: 'OK', fields: ['日期', '收盤價'], data: [['115/10/18', '10']] }, '2026-10')).toThrow();
  expect(() => parseHistory({ stat: 'OK', fields: ['日期', '收盤價'], data: [['115/10/16', '-10']] }, '2026-10')).toThrow();
  expect(() => parseHistory({ stat: '無資料', data: [] }, '2026-10')).toThrow();
});
it('combines monthly data, clips later dates and shares cached requests', async () => {
  const fetcher = vi.fn().mockImplementation(async url => ({ ok: true, json: async () => monthData(url.includes('202610') ? '2026-10' : '2026-09') }));
  const history = createHistoryService({ fetchImpl: fetcher });
  const [data, again] = await Promise.all([history.load('2330', '2026-10-16'), history.load('2330', '2026-10-16')]);
  expect(data.points).toEqual(again.points); expect(fetcher).toHaveBeenCalledTimes(2); expect(data.points.at(-1).date).toBe('2026-10-16'); expect(data.points[0].date).toBe('2026-09-16');
  await history.load('2330', '2026-10-16'); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('marks partial history as incomplete and never invents missing dates', async () => {
  const history = createHistoryService({ fetchImpl: async url => { if (url.includes('202609')) throw Error('offline'); return { ok: true, json: async () => monthData('2026-10') }; } });
  const data = await history.load('2330', '2026-10-16'); expect(data.warnings).toHaveLength(1); expect(data.points.map(p => p.date)).toEqual(['2026-10-15', '2026-10-16']);
});
it('reports complete network failure without synthetic data', async () => { await expect(createHistoryService({ fetchImpl: async () => { throw Error('offline'); } }).load('2330', '2026-10-16')).rejects.toThrow('offline'); });
it('includes the intervening February when thirty days span three months', async () => {
  const fetcher = vi.fn(async url => ({ ok: true, json: async () => ({ stat: 'OK', fields: ['日期', '收盤價'], data: [[url.includes('202603') ? '115/03/02' : url.includes('202602') ? '115/02/27' : '115/01/30', '100']] }) }));
  const result = await createHistoryService({ fetchImpl: fetcher }).load('2330', '2026-03-02');
  expect(fetcher).toHaveBeenCalledTimes(3); expect(result.points.map(p => p.date)).toEqual(['2026-02-27', '2026-03-02']); expect(result.warnings).toEqual([]);
});

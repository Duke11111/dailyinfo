import { validCode } from './stock-catalog.js';
import { parseTradingDate, parseFinancialNumber } from './quotes.js';

export function historyUrl(code, month) {
  if (!validCode(code) || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('歷史查詢代號或月份無效。');
  return `https://www.twse.com.tw/exchangeReport/STOCK_DAY?${new URLSearchParams({ response: 'json', date: month.replace('-', '') + '01', stockNo: code })}`;
}
export function parseHistory(data, month) {
  if (data?.stat !== 'OK' || !Array.isArray(data.fields) || !Array.isArray(data.data) || !data.data.length) throw new Error('此月份尚無可用歷史資料。');
  const dateIndex = data.fields.indexOf('日期'), closeIndex = data.fields.indexOf('收盤價');
  if (dateIndex < 0 || closeIndex < 0) throw new Error('歷史資料欄位異常。');
  const dates = new Set();
  return data.data.map(row => {
    if (!Array.isArray(row)) throw new Error('歷史資料列異常。');
    const date = parseTradingDate(row[dateIndex]);
    if (!date.startsWith(month) || dates.has(date) || [0, 6].includes(new Date(date + 'T12:00:00Z').getUTCDay())) throw new Error('歷史交易日期異常。');
    dates.add(date);
    const value = parseFinancialNumber(row[closeIndex]);
    return { date, close: value === 0 ? null : value };
  }).sort((a, b) => a.date.localeCompare(b.date));
}
export function createHistoryService({ fetchImpl = (...args) => fetch(...args), now = Date.now, ttl = 1800000 } = {}) {
  const cache = new Map(), pending = new Map();
  async function monthData(code, month) {
    const key = `${code}:${month}`;
    if (pending.has(key)) return pending.get(key);
    if (cache.has(key) && now() - cache.get(key).at < ttl) return cache.get(key).value;
    const request = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetchImpl(historyUrl(code, month), { signal: controller.signal });
        if (!response.ok) throw new Error(`歷史資料連線失敗（HTTP ${response.status}）。`);
        const points = parseHistory(await response.json(), month);
        const value = { points, fetchedAt: new Date(now()).toISOString(), source: historyUrl(code, month) };
        cache.set(key, { at: now(), value });
        // Bound a cache of market data, not the user's watchlist/group count.
        if (cache.size > 60) cache.delete(cache.keys().next().value);
        return value;
      } catch (error) { throw new Error(error.name === 'AbortError' ? '歷史資料連線逾時。' : error.message || '歷史資料讀取失敗。'); }
      finally { clearTimeout(timer); }
    })().finally(() => pending.delete(key));
    pending.set(key, request); return request;
  }
  return {
    async load(code, endDate) {
      const end = parseTradingDate(endDate), startObject = new Date(`${end}T12:00:00Z`);
      startObject.setUTCDate(startObject.getUTCDate() - 30);
      const start = startObject.toISOString().slice(0, 10);
      const months = [], cursor = new Date(`${end.slice(0, 7)}-01T12:00:00Z`);
      while (cursor.toISOString().slice(0, 7) >= start.slice(0, 7)) {
        months.push(cursor.toISOString().slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() - 1);
      }
      const results = [], warnings = [];
      // A 30-day window normally spans two months, but can span three around February.
      for (const month of months) {
        try { results.push(await monthData(code, month)); }
        catch (error) {
          const last = cache.get(`${code}:${month}`);
          if (last) results.push(last.value);
          warnings.push(`${month}：${error.message}${last ? ' 顯示最後有效快取，非最新資料。' : ''}`);
        }
      }
      if (!results.length) throw new Error(warnings.join('；'));
      return { points: results.flatMap(r => r.points).filter(p => p.date >= start && p.date <= end).sort((a, b) => a.date.localeCompare(b.date)), start, end, warnings, sources: results.map(r => r.source), fetchedAt: results.map(r => r.fetchedAt).sort().at(-1) };
    },
  };
}
export const stockHistory = createHistoryService();

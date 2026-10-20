import { readFileSync } from 'node:fs';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { validateCatalog, searchStocks, loadStockCatalog } from '../src/services/stock-catalog.js';
import { catalogFixture } from './fixtures/stock-catalog.js';
afterEach(() => vi.useRealTimers());
describe('stock catalog search and provenance', () => {
  it('loads a complete actual TWSE snapshot with both types and matching counts', () => {
    const data = validateCatalog(JSON.parse(readFileSync('public/data/stocks.json', 'utf8')));
    expect(data.stocks.length).toBe(data.sources.reduce((sum, s) => sum + s.count, 0));
    expect(data.stocks.filter(s => s.type === 'stock').length).toBeGreaterThan(1000);
    expect(data.stocks.filter(s => s.type === 'etf').length).toBeGreaterThan(200);
    expect(searchStocks(data.stocks, '2330')[0].name).toBe('台積電');
    expect(searchStocks(data.stocks, '0050')[0].type).toBe('etf');
  });
  it.each(['2330', '台積電', '臺積電', '台灣積體電路'])('finds code/short/full names %s', query => { expect(searchStocks(catalogFixture().stocks, query)[0].code).toBe('2330'); });
  it('supports ETF filtering, exact-code priority and no results', () => {
    const stocks = catalogFixture().stocks;
    expect(searchStocks(stocks, '台', 'etf').map(s => s.code)).toEqual(['0050']);
    expect(searchStocks(stocks, '2330', 'etf')).toEqual([]); expect(searchStocks(stocks, '不存在')).toEqual([]); expect(searchStocks(stocks, '')).toEqual([]);
  });
  it('rejects invalid search input', () => { expect(() => searchStocks([], 'x'.repeat(81))).toThrow('搜尋'); expect(() => searchStocks([], 'x', 'bad')).toThrow(); });
  it.each([
    d => { d.stocks = []; }, d => { d.stocks[0].code = '<script>'; }, d => { d.stocks[0].type = ['stock']; },
    d => { d.stocks.push(d.stocks[0]); }, d => { d.sources[0].url = 'javascript:alert(1)'; }, d => { d.fetchedAt = 'bad'; },
    d => { d.sources[0].count = 999; }, d => { d.sources[0].issuedDates = ['2026-02-30']; },
  ])('rejects broken catalog data', mutate => { const data = catalogFixture(); mutate(data); expect(() => validateCatalog(data)).toThrow(); });
});
describe('catalog transport', () => {
  it('fetches only the same-origin snapshot', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => catalogFixture() });
    expect((await loadStockCatalog({ fetchImpl: mock })).stocks).toHaveLength(3); expect(mock.mock.calls[0][0]).toBe('/data/stocks.json');
  });
  it('handles HTTP/API failure, malformed JSON and offline errors', async () => {
    await expect(loadStockCatalog({ fetchImpl: async () => ({ ok: false, status: 503 }) })).rejects.toThrow('503');
    await expect(loadStockCatalog({ fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError(); } }) })).rejects.toThrow('解析');
    await expect(loadStockCatalog({ fetchImpl: async () => { throw Error('offline'); } })).rejects.toThrow('offline');
  });
  it('aborts on timeout', async () => {
    vi.useFakeTimers();
    const promise = loadStockCatalog({ timeout: 10, fetchImpl: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))) });
    const assertion = expect(promise).rejects.toThrow('逾時'); await vi.advanceTimersByTimeAsync(10); await assertion;
  });
});

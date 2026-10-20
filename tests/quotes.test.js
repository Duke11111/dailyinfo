import { readFileSync } from 'node:fs';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { parseFinancialNumber as number, parseTradingDate, parseQuoteRows, validateQuoteSnapshot, changePercent, fetchQuoteSnapshot, createQuoteStore, sortByQuote } from '../src/services/quotes.js';
import { quoteRows, quoteFixture } from './fixtures/quotes.js';
afterEach(() => vi.useRealTimers());
describe('financial parsing', () => {
  it.each([['1,234.50', 1234.5], ['−12.50', -12.5], ['＋0.50', .5], [' 0.0000 ', 0]])('parses %s', (text, expected) => { expect(number(text, { signed: true })).toBe(expected); });
  it.each(['', '--', null, 'N/A'])('preserves a missing value %j', text => { expect(number(text)).toBeNull(); });
  it.each(['12,34', 'Infinity', '1e9', {}, '-5', '<b>5</b>', '1.0000001'])('rejects invalid prices %j', text => { expect(() => number(text)).toThrow(); });
  it('validates integer precision and counts', () => { expect(number('43,046,982', { integer: true })).toBe(43046982); expect(() => number('2.5', { integer: true })).toThrow(); expect(() => number('9007199254740992', { integer: true })).toThrow(); });
  it.each(['1151016', '115/10/16', '20261016', '2026-10-16'])('converts date %s', date => { expect(parseTradingDate(date)).toBe('2026-10-16'); });
  it.each(['1150230', '2026-02-30', '115/13/01', 1151016])('rejects invalid dates %j', date => { expect(() => parseTradingDate(date)).toThrow(); });
  it('computes change relative to a valid reference price only', () => {
    expect(changePercent(2420, -20)).toBeCloseTo(-20 / 2440 * 100);
    expect(changePercent(4250, 85)).toBeCloseTo(85 / 4165 * 100);
    expect(changePercent(109, .1)).toBeCloseTo(.1 / 108.9 * 100);
    expect(changePercent(0, 1)).toBeNull(); expect(changePercent(5, 5)).toBeNull(); expect(changePercent(5, null)).toBeNull();
  });
  it('parses code mappings, units and last valid Friday without inventing Monday data', () => {
    const result = quoteFixture(); expect(result.tradeDate).toBe('2026-10-16'); expect(result.quotes.find(q => q.code === '2330')).toMatchObject({ close: 2420, volume: 43046982, change: -20 });
    expect(validateQuoteSnapshot(result)).toMatchObject(result);
  });
  it('keeps zero volume, missing prices and special changes explicit', () => {
    const rows = quoteRows(); Object.assign(rows[0], { OpeningPrice: '--', HighestPrice: '--', LowestPrice: '--', ClosingPrice: '0', TradeVolume: '0', Change: 'X0.00' });
    const quote = parseQuoteRows(rows, '2026-10-19T12:00:00Z').quotes[0]; expect(quote.close).toBeNull(); expect(quote.volume).toBe(0); expect(quote.percent).toBeNull(); expect(quote.change).toBeNull(); expect(quote.status).toContain('特殊');
  });
  it.each([
    rows => { rows[0].Date = '1151018'; }, rows => { rows[0].Date = '1160104'; }, rows => { rows[0].Code = rows[1].Code; },
    rows => { rows[0].HighestPrice = '100'; }, rows => { rows[0].TradeVolume = '-1'; }, rows => { delete rows[0].ClosingPrice; },
    rows => { rows[1].Date = '1151015'; },
  ])('rejects abnormal rows instead of replacing them with zeros', mutate => { const rows = quoteRows(); mutate(rows); expect(() => parseQuoteRows(rows, '2026-10-19T12:00:00Z')).toThrow(); });
  it('rejects empty or forged snapshot metadata', () => { expect(() => parseQuoteRows([])).toThrow(); const data = quoteFixture(); data.tradeDate = '2026-10-19'; expect(() => validateQuoteSnapshot(data)).toThrow(); });
  it('validates the real production snapshot and all three requested codes', () => {
    const data = validateQuoteSnapshot(JSON.parse(readFileSync('public/data/quotes.json', 'utf8')));
    expect(data.quotes.length).toBeGreaterThan(1000); for (const code of ['2330', '2454', '0050']) expect(data.quotes.find(q => q.code === code)?.close).toBeGreaterThan(0);
  });
});
describe('snapshot loading and shared cache', () => {
  it('loads a same-origin production-compatible snapshot', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => quoteFixture() });
    const data = await fetchQuoteSnapshot({ fetchImpl: fetcher }); expect(data.quotes).toHaveLength(3); expect(fetcher.mock.calls[0][0]).toBe(`${import.meta.env.BASE_URL}data/quotes.json`); expect(fetcher.mock.calls[0][1].cache).toBe('no-store');
  });
  it('handles HTTP, malformed JSON, empty responses and offline errors', async () => {
    await expect(fetchQuoteSnapshot({ fetchImpl: async () => ({ ok: false, status: 503 }) })).rejects.toThrow('503');
    await expect(fetchQuoteSnapshot({ fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError(); } }) })).rejects.toThrow('JSON');
    await expect(fetchQuoteSnapshot({ fetchImpl: async () => { throw Error('offline'); } })).rejects.toThrow('offline');
    await expect(fetchQuoteSnapshot({ fetchImpl: async () => ({ ok: true, json: async () => ({ ...quoteFixture(), quotes: [] }) }) })).rejects.toThrow();
  });
  it('times out a hanging request', async () => {
    vi.useFakeTimers(); const request = fetchQuoteSnapshot({ timeout: 10, fetchImpl: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))) });
    const assertion = expect(request).rejects.toThrow('逾時'); await vi.advanceTimersByTimeAsync(10); await assertion;
  });
  it('coalesces requests, caches five minutes and refreshes with a cooldown', async () => {
    let time = 1000; const fetcher = vi.fn().mockResolvedValue(quoteFixture()); const store = createQuoteStore({ fetcher, now: () => time });
    const first = store.load(), second = store.load({ force: true }); expect(first).toBe(second); await first;
    await store.load(); await store.load({ force: true }); expect(fetcher).toHaveBeenCalledTimes(1);
    time += 10001; await store.load({ force: true }); expect(fetcher).toHaveBeenCalledTimes(2);
    time += 300001; await store.load(); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('preserves last good data on failure or rollback and clears pending state', async () => {
    let time = 0; const fetcher = vi.fn().mockResolvedValue(quoteFixture()); const store = createQuoteStore({ fetcher, now: () => time });
    await store.load(); time += 10001; fetcher.mockRejectedValueOnce(Error('offline'));
    await expect(store.load({ force: true })).rejects.toThrow('offline'); expect(store.peek().tradeDate).toBe('2026-10-16');
    time += 10001; fetcher.mockResolvedValueOnce({ ...quoteFixture(), tradeDate: '2026-10-15' }); await expect(store.load({ force: true })).rejects.toThrow('較舊'); expect(store.peek().tradeDate).toBe('2026-10-16');
  });
  it('sorts prices, percentages, volumes with nulls last and custom input unchanged', () => {
    const stocks = [{ code: 'missing' }, ...quoteFixture().quotes], original = [...stocks]; const map = new Map(quoteFixture().quotes.map(q => [q.code, q]));
    expect(sortByQuote(stocks, 'close', map).map(s => s.code)).toEqual(['2454', '2330', '0050', 'missing']);
    expect(sortByQuote(stocks, 'percent', map)[0].code).toBe('2454'); expect(sortByQuote(stocks, 'volume', map)[0].code).toBe('0050'); expect(stocks).toEqual(original);
  });
});

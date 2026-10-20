import { it, expect, vi } from 'vitest';
import { validateExchangeSnapshot, filterCurrencies, convertExchange, exchangeAmount, createExchangeStore, fetchExchangeSnapshot, isExchangeStale } from '../src/services/exchange.js';
import { parseBankExchange } from '../scripts/lib/exchange-import.mjs';
import { exchangeFixture, exchangeCsv, exchangeHtml, exchangeCaptured } from './fixtures/exchange.js';
it('parses official CSV columns, correlates HTML timestamp, and treats zero placeholders as missing', () => {
  const data = parseBankExchange(exchangeCsv(), exchangeHtml(), exchangeCaptured); expect(data.rates).toEqual(exchangeFixture().rates); expect(data.quotedAt).toBe('2026-10-20T00:42:00+08:00'); expect(data.evidence.csvSha256).toMatch(/^[a-f0-9]{64}$/); expect(data.rates[3].spot).toEqual({ buy: null, sell: null });
});
it('rejects CSV/HTML changes between requests rather than assigning a false timestamp', () => {
  expect(() => parseBankExchange(exchangeCsv().replace('32.00000', '31.00000'), exchangeHtml(), exchangeCaptured)).toThrow('不一致');
  expect(() => parseBankExchange(exchangeCsv().replace('本行買入', '本行賣出'), exchangeHtml(), exchangeCaptured)).toThrow('買賣欄位');
  expect(() => parseBankExchange(exchangeCsv(), exchangeHtml().replace('牌價最新掛牌時間', 'unknown'), exchangeCaptured)).toThrow('牌告時間');
});
it.each([
  data => { data.sourceUrl = 'https://evil.test'; }, data => { data.quotedAt = '2026-02-30T00:00:00+08:00'; }, data => { data.quotedAt = '2026-10-21T00:00:00+08:00'; },
  data => { data.rates[0].code = 'XXX'; }, data => { data.rates.push(data.rates[0]); }, data => { data.rates[0].cash.buy = -1; },
  data => { data.rates[0].cash.sell = 0; }, data => { data.rates[0].spot.buy = '32'; }, data => { data.rates[0].cash.buy = 99; }, data => { data.rates = []; },
])('rejects invalid currencies, dates, prices, direction pairs and URLs', mutate => { const data = exchangeFixture(); mutate(data); expect(() => validateExchangeSnapshot(data)).toThrow(); });
it('searches ISO codes, source names and Chinese aliases without fabricating currencies', () => {
  const rates = exchangeFixture().rates; expect(filterCurrencies(rates, 'usd')[0].name).toBe('美金'); expect(filterCurrencies(rates, '美元')[0].code).toBe('USD'); expect(filterCurrencies(rates, '韓元')[0].code).toBe('KRW'); expect(filterCurrencies(rates, 'XYZ')).toEqual([]);
});
it.each([
  ['100', 'cash', 'toTwd', '3200.000000', 32, 'buy'], ['100', 'spot', 'toTwd', '3210.000000', 32.1, 'buy'],
  ['3300', 'cash', 'toForeign', '100.000000', 33, 'sell'], ['3250', 'spot', 'toForeign', '100.000000', 32.5, 'sell'],
  ['0', 'cash', 'toForeign', '0.000000', 33, 'sell'], ['.5', 'cash', 'toTwd', '16.000000', 32, 'buy'],
])('converts %s using %s / %s with the correct bank side', (amount, mode, direction, value, rate, side) => { expect(convertExchange(amount, exchangeFixture().rates[0], mode, direction)).toMatchObject({ value, rate, side }); });
it('handles exact decimal multiplication, repeating division and large amounts with integer arithmetic', () => {
  expect(convertExchange('0.1', { ...exchangeFixture().rates[0], cash: { buy: .2, sell: .3 } }, 'cash', 'toTwd').value).toBe('0.020000');
  expect(convertExchange('1000', exchangeFixture().rates[1], 'cash', 'toForeign').value).toBe('4761.904762');
  expect(convertExchange('1000000000000', exchangeFixture().rates[0], 'cash', 'toTwd').value).toBe('32000000000000.000000'); expect(exchangeAmount('32000000000000.000000')).toBe('32,000,000,000,000.00');
});
it.each(['', '-1', 'NaN', 'Infinity', '1e3', '1,000', '<img>', '0.0000001', '1000000000000.000001', '1000000000001'])('rejects invalid amount %s', amount => { expect(() => convertExchange(amount, exchangeFixture().rates[0], 'cash', 'toTwd')).toThrow(); });
it('does not substitute cash rates for unavailable spot rates, including zero amount', () => {
  expect(() => convertExchange('0', exchangeFixture().rates[3], 'spot', 'toTwd')).toThrow('未提供'); expect(() => convertExchange('100', exchangeFixture().rates[0], 'unknown', 'toTwd')).toThrow();
});
it('distinguishes stale quote times from newly fetched snapshots', () => {
  const data = exchangeFixture(); expect(isExchangeStale(data, Date.parse(exchangeCaptured))).toBe(false); data.quotedAt = '2026-10-17T16:00:00+08:00'; expect(isExchangeStale(data, Date.parse(exchangeCaptured))).toBe(true);
});
it('coalesces requests, caches reads and preserves good data after errors or older snapshots', async () => {
  let now = Date.parse(exchangeCaptured); const fetcher = vi.fn().mockResolvedValue(exchangeFixture()), store = createExchangeStore({ fetcher, now: () => now });
  const first = store.load(); expect(store.load()).toBe(first); await first; await store.load(); expect(fetcher).toHaveBeenCalledTimes(1);
  now += 11000; fetcher.mockRejectedValueOnce(Error('offline')); await expect(store.load({ force: true })).rejects.toThrow('offline'); expect(store.peek().rates).toHaveLength(4);
  now += 11000; fetcher.mockResolvedValueOnce({ ...exchangeFixture(), quotedAt: '2026-10-19T00:00:00+08:00' }); await expect(store.load({ force: true })).rejects.toThrow('較舊'); expect(store.peek().quotedAt).toBe(exchangeFixture().quotedAt);
});
it('handles HTTP, JSON and timeout errors without accessing any bank endpoint from the frontend', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 })); await expect(fetchExchangeSnapshot({ fetchImpl })).rejects.toThrow('404'); expect(fetchImpl.mock.calls[0][0]).toContain('data/exchange.json');
  await expect(fetchExchangeSnapshot({ fetchImpl: async () => ({ ok: true, json() { throw SyntaxError(); } }) })).rejects.toThrow('JSON');
  await expect(fetchExchangeSnapshot({ timeout: 5, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('', 'AbortError')))) })).rejects.toThrow('逾時');
});

import { it, expect } from 'vitest';
import { explorationEntries } from '../src/services/stock-exploration.js';
import { catalogFixture } from './fixtures/stock-catalog.js';
import { quoteFixture } from './fixtures/quotes.js';
const fixture = () => {
  const catalog = catalogFixture(), snapshot = quoteFixture();
  catalog.stocks.push({ code: '2454', name: '聯發科', fullName: '聯發科技股份有限公司', type: 'stock' });
  return { catalog, snapshot };
};
it('ranks by actual share volume rather than price or traded value', () => {
  const { catalog, snapshot } = fixture();
  expect(explorationEntries(catalog, snapshot).map(item => item.stock.code)).toEqual(['0050', '2330', '2454']);
  expect(explorationEntries(catalog, snapshot)[0].quote.volume).toBe(122160698);
});
it('ranks reliable percentage gains descending and keeps inputs untouched', () => {
  const { catalog, snapshot } = fixture(), original = JSON.stringify({ catalog, snapshot });
  expect(explorationEntries(catalog, snapshot, { mode: 'gain' }).map(item => item.stock.code)).toEqual(['2454', '0050', '2330']);
  expect(JSON.stringify({ catalog, snapshot })).toBe(original);
});
it.each(['volume', 'gain', 'common'])('applies ETF / stock filters to %s', mode => {
  const { catalog, snapshot } = fixture();
  expect(explorationEntries(catalog, snapshot, { mode, type: 'etf' }).map(item => item.stock.code)).toEqual(['0050']);
  expect(explorationEntries(catalog, snapshot, { mode, type: 'stock' }).every(item => item.stock.type === 'stock')).toBe(true);
});
it.each([null, 0, -1, NaN, Infinity, '2420'])('excludes invalid close %s from rankings', close => {
  const { catalog, snapshot } = fixture(); snapshot.quotes[0].close = close;
  expect(explorationEntries(catalog, snapshot).some(item => item.stock.code === '2330')).toBe(false);
});
it.each([null, 0, -1, 1.5, '100', Infinity])('does not invent a ranking for invalid volume %s', volume => {
  const { catalog, snapshot } = fixture(); snapshot.quotes.forEach(quote => { quote.volume = volume; });
  expect(explorationEntries(catalog, snapshot)).toEqual([]);
  expect(explorationEntries(catalog, snapshot, { mode: 'gain' })).toEqual([]);
});
it('excludes suspended, special and inconsistent percentage data from gains', () => {
  const { catalog, snapshot } = fixture();
  snapshot.quotes[0].status = '停牌'; snapshot.quotes[1].percent = 999; snapshot.quotes[2].change = null;
  expect(explorationEntries(catalog, snapshot, { mode: 'gain' })).toEqual([]);
});
it('only ranks matching dates and identifiable catalog products', () => {
  const { catalog, snapshot } = fixture(); snapshot.quotes[0].date = '2026-10-15'; catalog.stocks = catalog.stocks.filter(item => item.code !== '2454');
  expect(explorationEntries(catalog, snapshot).map(item => item.stock.code)).toEqual(['0050']);
});
it('keeps common list ordering with real catalog names and missing quotes', () => {
  const { catalog, snapshot } = fixture(); const entries = explorationEntries(catalog, snapshot, { mode: 'common' });
  expect(entries.map(item => item.stock.code)).toEqual(['2330', '2317', '2454', '0050']); expect(entries[1].quote).toBeUndefined();
  expect(entries[0].stock.name).toBe('台積電'); expect(explorationEntries(null, snapshot, { mode: 'common' })).toEqual([]);
});
it('returns only ten largest eligible products with deterministic tie ordering', () => {
  const { snapshot } = fixture(); const catalog = { stocks: [] }; const base = snapshot.quotes[0]; snapshot.quotes = [];
  for (let i = 0; i < 25; i++) { const code = String(1000 + i); catalog.stocks.push({ code, name: code, type: 'stock' }); snapshot.quotes.push({ ...base, code, volume: 100 }); }
  expect(explorationEntries(catalog, snapshot).map(item => item.stock.code)).toEqual(Array.from({ length: 10 }, (_, i) => String(1000 + i)));
});
it.each([{ mode: 'unknown' }, { type: 'foreign' }, { limit: 0 }, { limit: 100 }])('rejects invalid exploration options %j', options => {
  expect(() => explorationEntries(null, null, options)).toThrow('探索條件無效');
});

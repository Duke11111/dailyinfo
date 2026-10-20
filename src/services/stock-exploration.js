import { validateStock } from './stock-catalog.js';
import { changePercent } from './quotes.js';

export const EXPLORATION_MODES = Object.freeze({ volume: '成交量排行榜', gain: '漲幅排行榜', common: '常見關注' });
export const COMMON_CODES = Object.freeze(['2330', '2317', '2454', '2303', '2881', '0050']);
const price = value => Number.isFinite(value) && value > 0 && value <= 10000000;
export function explorationEntries(catalog, snapshot, { mode = 'volume', type = 'all', limit = 10 } = {}) {
  if (!Object.hasOwn(EXPLORATION_MODES, mode) || !['all', 'stock', 'etf'].includes(type) || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('探索條件無效。');
  const stocks = new Map((catalog?.stocks ?? []).filter(stock => validateStock(stock) && (type === 'all' || stock.type === type)).map(stock => [stock.code, stock]));
  const quotes = new Map((snapshot?.quotes ?? []).filter(quote => stocks.has(quote.code) && quote.date === snapshot.tradeDate).map(quote => [quote.code, quote]));
  if (mode === 'common') return COMMON_CODES.filter(code => stocks.has(code)).slice(0, limit).map(code => ({ stock: stocks.get(code), quote: quotes.get(code) }));
  const entries = [...quotes.values()].filter(quote => price(quote.close) && Number.isSafeInteger(quote.volume) && quote.volume > 0);
  const eligible = mode === 'gain' ? entries.filter(quote => {
    const percent = changePercent(quote.close, quote.change);
    return quote.status === '一般交易資料' && Number.isFinite(percent) && Number.isFinite(quote.percent) && Math.abs(percent - quote.percent) < 0.000001;
  }) : entries;
  return eligible.sort((a, b) => (mode === 'volume' ? b.volume - a.volume : b.percent - a.percent) || a.code.localeCompare(b.code)).slice(0, limit).map(quote => ({ stock: stocks.get(quote.code), quote }));
}

import { validDateOnly } from '../lib/time.js';
import { CACHE_POLICY } from './cache-policy.js';
import { createSnapshotStore, browserCacheStorage } from './snapshot-store.js';
export const STOCK_TYPES = Object.freeze({ stock: '上市股票', etf: '上市 ETF' });
export const validCode = code => typeof code === 'string' && /^[0-9A-Z]{4,6}$/.test(code);
export const validText = (value, max = 160) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
export function validateStock(stock) {
  return stock && typeof stock === 'object' && validCode(stock.code) && validText(stock.name) && typeof stock.type === 'string' && Object.hasOwn(STOCK_TYPES, stock.type);
}
export function validateCatalog(data) {
  const validDate = validDateOnly;
  if (!data || data.version !== 1 || !Array.isArray(data.stocks) || !data.stocks.length
    || !data.stocks.every(s => validateStock(s) && validText(s.fullName))
    || new Set(data.stocks.map(s => s.code)).size !== data.stocks.length
    || !Array.isArray(data.sources) || data.sources.length !== 2
    || !data.sources.every(s => validText(s.label) && /^https:\/\/openapi\.twse\.com\.tw\/v1\/opendata\/t187ap(03|47)_L$/.test(s.url)
      && Number.isInteger(s.count) && s.count > 0
      && Array.isArray(s.issuedDates) && s.issuedDates.length && s.issuedDates.every(validDate))
    || new Set(data.sources.map(s => s.url)).size !== 2
    || !data.sources.every(source => data.stocks.filter(stock => stock.type === (source.url.endsWith('03_L') ? 'stock' : 'etf')).length === source.count)
    || typeof data.fetchedAt !== 'string' || !Number.isFinite(Date.parse(data.fetchedAt))) throw new Error('股票目錄格式異常，請重試或重新匯入正式資料。');
  return data;
}
async function fetchStockCatalog({ fetchImpl = fetch, signal, timeout = CACHE_POLICY.timeout } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetchImpl(`${import.meta.env?.BASE_URL ?? '/'}data/stocks.json`, { signal: controller.signal });
    if (!response.ok) throw new Error(`股票目錄讀取失敗（HTTP ${response.status}）。`);
    return validateCatalog(await response.json());
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('股票目錄讀取逾時或已取消，請重新載入目錄。');
    if (error instanceof SyntaxError) throw new Error('股票目錄無法解析，請重新載入目錄。');
    throw new Error(error?.message || '無法讀取股票目錄，請確認網路後重試。');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
let catalogStore, transport;
function sharedCatalog() {
  // A replaced transport is a distinct dependency-injection scope.
  if (transport !== globalThis.fetch || !catalogStore) {
    transport = globalThis.fetch;
    catalogStore = createSnapshotStore({ name: 'catalog', fetcher: () => fetchStockCatalog({ fetchImpl: transport }), validate: validateCatalog, storage: browserCacheStorage(), cooldown: 0 });
  }
  return catalogStore;
}
export function loadStockCatalog(options = {}) {
  if (options.fetchImpl || options.timeout) return fetchStockCatalog(options);
  if (options.signal?.aborted) return Promise.reject(new DOMException('目錄查詢已取消。', 'AbortError'));
  const pending = sharedCatalog().load();
  if (!options.signal) return pending.then(result => result.data);
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('目錄查詢已取消。', 'AbortError'));
    options.signal.addEventListener('abort', abort, { once: true });
    pending.then(result => resolve(result.data), reject).finally(() => options.signal.removeEventListener('abort', abort));
  });
}
loadStockCatalog.peek = () => sharedCatalog().peek();
const normalize = text => text.normalize('NFKC').replace(/臺/g, '台').replace(/\s/g, '').toLowerCase();
export function searchStocks(stocks, query, type = 'all') {
  if (!Array.isArray(stocks) || typeof query !== 'string' || query.length > 80 || !['all', 'stock', 'etf'].includes(type)) throw new Error('搜尋條件無效，請重新輸入。');
  const needle = normalize(query);
  if (!needle) return [];
  return stocks.filter(s => (type === 'all' || s.type === type) && [s.code, s.name, s.fullName].some(value => normalize(value).includes(needle)))
    .sort((a, b) => Number(normalize(b.code) === needle) - Number(normalize(a.code) === needle) || a.code.localeCompare(b.code));
}

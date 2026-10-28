import { isoInstant, nowMs } from '../lib/time.js';
import { createSnapshotStore, browserCacheStorage } from './snapshot-store.js';
import { CACHE_POLICY, quoteCacheTTL } from './cache-policy.js';
import { taipeiDate, validDateOnly, optionalUpdatedAt, taipeiStartOfDay, calendarWeekday } from '../lib/time.js';
import { validCode, validText } from './stock-catalog.js';

export const QUOTE_SOURCE = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
export const QUOTE_FALLBACK_SOURCE = 'https://www.twse.com.tw/exchangeReport/MI_INDEX';
export const QUOTE_MARKET_SOURCE = 'https://www.twse.com.tw/exchangeReport/FMTQIK';
export function quoteReportUrl(source, day) {
  if (!validDateOnly(day) || ![QUOTE_FALLBACK_SOURCE, QUOTE_MARKET_SOURCE].includes(source)) throw Error('行情來源日期異常。');
  return `${source}?response=json&${source === QUOTE_FALLBACK_SOURCE ? 'type=ALLBUT0999&' : ''}date=${day.replaceAll('-', '')}`;
}
export function quoteSourceDetails(snapshot) {
  return snapshot?.source === QUOTE_FALLBACK_SOURCE
    ? { label: 'TWSE MI_INDEX（日期專屬盤後行情）', url: quoteReportUrl(QUOTE_FALLBACK_SOURCE, snapshot.tradeDate) }
    : { label: 'TWSE STOCK_DAY_ALL', url: QUOTE_SOURCE };
}
export function quoteExpectedTradeDate(snapshot, now = nowMs()) {
  const evidence = snapshot.evidence;
  return evidence && taipeiDate(evidence.checkedAt) === taipeiDate(now)
    && now - Date.parse(evidence.checkedAt) >= 0 && now - Date.parse(evidence.checkedAt) <= 15 * 60000
    ? evidence.eligibleTradeDate : taipeiDate(now);
}
function quoteEvidence(data) {
  if (data.evidence === undefined && data.source === QUOTE_SOURCE) return {};
  const e = data.evidence, today = e && taipeiDate(e.checkedAt);
  const validDay = day => validDateOnly(day) && day >= '2000-01-01' && ![0, 6].includes(calendarWeekday(day));
  let dateProof;
  if (e?.dateProof !== undefined) {
    const p = e.dateProof;
    if (!p || !validDay(p.tradeDate) || p.tradeDate !== data.tradeDate || p.tradeDate !== e.eligibleTradeDate
      || p.url !== quoteReportUrl(QUOTE_FALLBACK_SOURCE, p.tradeDate) || !/^[a-f0-9]{64}$/.test(p.sha256)
      || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(p.fetchedAt) || !Number.isFinite(Date.parse(p.fetchedAt))
      || Date.parse(p.fetchedAt) > nowMs() + 300000 || taipeiDate(p.fetchedAt) < p.tradeDate
      || data.source === QUOTE_FALLBACK_SOURCE && (p.sha256 !== data.sha256 || p.fetchedAt !== data.fetchedAt)) throw Error('官方日期專屬行情證據異常。');
    dateProof = { tradeDate: p.tradeDate, url: p.url, sha256: p.sha256, fetchedAt: p.fetchedAt };
  }
  if (!e || e.version !== 1 || !Number.isFinite(Date.parse(e.checkedAt)) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(e.checkedAt)
    || Date.parse(e.checkedAt) > nowMs() + 300000
    || !validDay(e.latestPublishedTradeDate) || !validDay(e.eligibleTradeDate)
    || e.eligibleTradeDate > e.latestPublishedTradeDate || e.latestPublishedTradeDate > today
    || data.tradeDate > e.eligibleTradeDate || data.source === QUOTE_FALLBACK_SOURCE && data.tradeDate !== e.eligibleTradeDate
    || !validDateOnly(e.marketDate) || e.marketDate > today
    || !dateProof && e.eligibleTradeDate.slice(0, 7) !== e.marketDate.slice(0, 7)
    || !/^[a-f0-9]{64}$/.test(e.marketSha256) || !/^[a-f0-9]{64}$/.test(data.sha256)
    || !/^[a-f0-9]{64}$/.test(e.publicationSha256) || e.publicationUrl !== quoteReportUrl(QUOTE_MARKET_SOURCE, today)
    || e.marketUrl !== quoteReportUrl(QUOTE_MARKET_SOURCE, e.marketDate)
    || e.method !== (data.source === QUOTE_SOURCE ? 'twse-openapi' : 'twse-mi-index')
    || e.dataUrl !== (data.source === QUOTE_SOURCE ? QUOTE_SOURCE : quoteReportUrl(QUOTE_FALLBACK_SOURCE, data.tradeDate))
    || e.eligibleTradeDate === today && Date.parse(e.checkedAt) < taipeiStartOfDay(today) + (17 * 60 + 17) * 60000) throw Error('官方行情日期證據異常。');
  return { evidence: { version: 1, method: e.method, dataUrl: e.dataUrl, marketUrl: e.marketUrl, marketDate: e.marketDate,
    latestPublishedTradeDate: e.latestPublishedTradeDate, eligibleTradeDate: e.eligibleTradeDate, checkedAt: e.checkedAt, marketSha256: e.marketSha256,
    publicationUrl: e.publicationUrl, publicationSha256: e.publicationSha256, ...(dateProof ? { dateProof } : {}) } };
}
const missing = new Set(['', '--', '---', 'N/A', 'NA', 'NULL', '不適用']);
export { taipeiDate } from '../lib/time.js';
export function parseTradingDate(raw) {
  if (typeof raw !== 'string') throw new Error('交易日期型別異常。');
  let value = raw.trim();
  if (/^\d{7}$/.test(value)) value = `${Number(value.slice(0, 3)) + 1911}-${value.slice(3, 5)}-${value.slice(5)}`;
  else if (/^\d{3}\/\d{2}\/\d{2}$/.test(value)) value = `${Number(value.slice(0, 3)) + 1911}-${value.slice(4, 6)}-${value.slice(7)}`;
  else if (/^\d{8}$/.test(value)) value = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  if (!validDateOnly(value) || value < '2000-01-01') throw new Error('交易日期無效。');
  return value;
}
export function parseFinancialNumber(raw, { integer = false, signed = false } = {}) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') throw new Error('金融數字型別異常。');
  const text = String(raw).normalize('NFKC').replace(/[−－]/g, '-').trim();
  if (missing.has(text.toUpperCase())) return null;
  const expression = integer ? /^\d+(?:,\d{3})*$/ : /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/;
  if (!expression.test(text) || (integer && text.includes(',') && !/^\d{1,3}(,\d{3})+$/.test(text))) throw new Error('金融數字格式異常。');
  const number = Number(text.replaceAll(',', ''));
  if (!Number.isFinite(number) || (!signed && number < 0) || (integer && !Number.isSafeInteger(number)) || (!integer && Math.abs(number) > 10000000)) throw new Error('金融數字超出有效範圍。');
  return number;
}
export function changePercent(close, change) {
  if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(change)) return null;
  const reference = close - change;
  return reference > 0 ? change / reference * 100 : null;
}
function parsePrice(value) {
  const number = parseFinancialNumber(value);
  if (number === 0) return null; // zero is not a valid execution price
  return number;
}
export function parseQuoteRows(rows, fetchedAt = isoInstant()) {
  if (!Array.isArray(rows) || !rows.length || typeof fetchedAt !== 'string' || !Number.isFinite(Date.parse(fetchedAt))) throw new Error('盤後行情無資料或擷取時間無效。');
  const codes = new Set();
  const today = taipeiDate(fetchedAt);
  const quotes = rows.map(row => {
    if (!row || !validCode(row.Code) || !validText(row.Name) || codes.has(row.Code)) throw new Error('行情股票代號或名稱異常。');
    if (!['OpeningPrice', 'HighestPrice', 'LowestPrice', 'ClosingPrice', 'Change', 'TradeVolume', 'TradeValue', 'Transaction'].every(key => Object.hasOwn(row, key))) throw new Error('行情資料缺少必要欄位。');
    codes.add(row.Code);
    const date = parseTradingDate(row.Date);
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (date > today || day === 0 || day === 6) throw new Error('行情交易日為未來或非正常交易日。');
    const open = parsePrice(row.OpeningPrice), high = parsePrice(row.HighestPrice), low = parsePrice(row.LowestPrice), close = parsePrice(row.ClosingPrice);
    const volume = parseFinancialNumber(row.TradeVolume, { integer: true });
    const value = parseFinancialNumber(row.TradeValue, { integer: true });
    const transactions = parseFinancialNumber(row.Transaction, { integer: true });
    // X denotes an incomparable / special reference condition. Do not strip it into a fake signed change.
    const special = typeof row.Change === 'string' && /^X/i.test(row.Change.trim());
    const change = special ? null : parseFinancialNumber(row.Change, { signed: true });
    if ((high !== null && low !== null && high < low) || [open, close].some(price => price !== null && ((high !== null && price > high) || (low !== null && price < low)))) throw new Error(`行情價格區間異常：${row.Code}`);
    return { code: row.Code, name: row.Name, date, open, high, low, close, change, percent: changePercent(close, change), volume, value, transactions,
      status: special ? '特殊參考狀態，漲跌不適用' : volume === 0 ? '無成交' : close === null ? '無有效收盤價' : '一般交易資料' };
  });
  const dates = [...new Set(quotes.map(q => q.date))];
  if (dates.length !== 1) throw new Error('同一批行情交易日期不一致。');
  return { version: 1, source: QUOTE_SOURCE, fetchedAt, tradeDate: dates[0], quotes };
}
export function validateQuoteSnapshot(data) {
  if (!data || data.version !== 1 || ![QUOTE_SOURCE, QUOTE_FALLBACK_SOURCE].includes(data.source) || !Array.isArray(data.quotes)) throw new Error('行情快照格式異常。');
  if (!data.quotes.every(q => q && ['open', 'high', 'low', 'close', 'change', 'volume', 'value', 'transactions'].every(key => Object.hasOwn(q, key)))) throw new Error('行情快照欄位不完整。');
  // Revalidate normalized snapshots with the same rules as the official response.
  const parsed = parseQuoteRows(data.quotes.map(q => ({ Code: q?.code, Name: q?.name, Date: q?.date, OpeningPrice: q?.open, HighestPrice: q?.high, LowestPrice: q?.low, ClosingPrice: q?.close, Change: q?.status === '特殊參考狀態，漲跌不適用' ? 'X' : q?.change, TradeVolume: q?.volume, TradeValue: q?.value, Transaction: q?.transactions })), data.fetchedAt);
  if (parsed.tradeDate !== data.tradeDate) throw new Error('快照交易日標記不一致。');
  return { ...parsed, source: data.source, ...optionalUpdatedAt(data), sha256: typeof data.sha256 === 'string' ? data.sha256 : null, ...quoteEvidence(data) };
}
export async function fetchQuoteSnapshot({ fetchImpl = fetch, timeout = CACHE_POLICY.timeout } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(`${import.meta.env?.BASE_URL ?? '/'}data/quotes.json`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`行情快照讀取失敗（HTTP ${response.status}）。`);
    let data;
    try { data = await response.json(); } catch (error) { if (error.name === 'AbortError') throw error; throw new Error('行情快照不是有效 JSON。'); }
    return validateQuoteSnapshot(data);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('行情讀取逾時，請稍後重新整理。');
    throw new Error(error.message || '行情讀取失敗，請檢查網路。');
  } finally { clearTimeout(timer); }
}
export function createQuoteStore({ fetcher = fetchQuoteSnapshot, now = nowMs, ttl = quoteCacheTTL, cooldown = CACHE_POLICY.cooldown, storage = null } = {}) {
  return createSnapshotStore({ name: 'quotes', fetcher, now, ttl, cooldown, storage, validate: validateQuoteSnapshot, sourceDay: value => value.tradeDate });
}
export const quoteStore = createQuoteStore({ storage: browserCacheStorage() });
export const QUOTE_SORTS = Object.freeze({ close: '收盤價（高→低）', percent: '漲跌幅（高→低）', volume: '成交量（大→小）' });
export function sortByQuote(stocks, sort, quotes) {
  if (!Object.hasOwn(QUOTE_SORTS, sort)) return stocks;
  return [...stocks].sort((a, b) => {
    const x = quotes.get(a.code)?.[sort], y = quotes.get(b.code)?.[sort];
    const nx = !Number.isFinite(x), ny = !Number.isFinite(y);
    return nx !== ny ? nx ? 1 : -1 : nx ? 0 : y - x;
  });
}

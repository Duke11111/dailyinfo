import { createHash } from 'node:crypto';
import { CACHE_POLICY } from '../../src/services/cache-policy.js';
import { QUOTE_SOURCE, QUOTE_FALLBACK_SOURCE, QUOTE_MARKET_SOURCE, quoteReportUrl,
  parseQuoteRows, parseTradingDate, parseFinancialNumber, validateQuoteSnapshot } from '../../src/services/quotes.js';
import { taipeiDate, taipeiStartOfDay, addCalendarDays, calendarWeekday, isoInstant, nowMs } from '../../src/lib/time.js';
import { compareSnapshots } from '../../src/lib/snapshot-freshness.js';

const hash = text => createHash('sha256').update(text).digest('hex');
const reject = () => { throw Error('twse_validation_failed'); };
const marketFields = ['日期', '成交股數', '成交金額', '成交筆數', '發行量加權股價指數', '漲跌點數'];
const quoteFields = ['證券代號', '證券名稱', '成交股數', '成交筆數', '成交金額', '開盤價', '最高價', '最低價', '收盤價', '漲跌(+/-)', '漲跌價差', '最後揭示買價', '最後揭示買量', '最後揭示賣價', '最後揭示賣量', '本益比'];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const roc = day => `${Number(day.slice(0, 4)) - 1911}年${day.slice(5, 7)}月${day.slice(8)}日`;
function complete(snapshot) {
  if (snapshot.quotes.length < 1000 || !['2330', '2454', '0050'].every(code => snapshot.quotes.some(q => q.code === code))) reject();
  return snapshot;
}
export function parseMarketDays(payload, requestedDay, now = nowMs()) {
  const month = requestedDay.slice(0, 7), today = taipeiDate(now);
  if (payload?.stat === '很抱歉，沒有符合條件的資料!' && payload.data == null) return [];
  if (payload?.stat !== 'OK' || payload.date !== requestedDay.replaceAll('-', '') || !equal(payload.fields, marketFields)
    || payload.title !== `${Number(month.slice(0, 4)) - 1911}年${month.slice(5)}月市場成交資訊`
    || !Array.isArray(payload.data) || !payload.data.length) reject();
  let previous = '';
  return payload.data.map(row => {
    if (!Array.isArray(row) || row.length !== marketFields.length) reject();
    const day = parseTradingDate(row[0]);
    if (!day.startsWith(month) || day > today || day <= previous || [0, 6].includes(calendarWeekday(day))) reject();
    previous = day;
    for (let i = 1; i < 6; i++) {
      const value = parseFinancialNumber(row[i], { integer: i < 4, signed: i === 5 });
      if (value === null || i < 5 && value <= 0) reject();
    }
    return day;
  });
}
export function parseMiIndex(payload, day, fetchedAt) {
  if (payload?.stat !== 'OK' || payload.date !== day.replaceAll('-', '') || payload.type !== 'ALLBUT0999'
    || payload.params?.date !== payload.date || payload.params?.type !== 'ALLBUT0999'
    || !Array.isArray(payload.tables)) reject();
  const tables = payload.tables.filter(table => Array.isArray(table.fields) && table.fields[0] === '證券代號');
  if (tables.length !== 1 || !equal(tables[0].fields, quoteFields)
    || tables[0].title !== `${roc(day)} 每日收盤行情(全部(不含權證、牛熊證、可展延牛熊證))`
    || !Array.isArray(tables[0].data)) reject();
  const rows = tables[0].data.map(row => {
    if (!Array.isArray(row) || row.length !== quoteFields.length) reject();
    const signs = { '+': '+', '-': '-', '': '', X: 'X', '<p style= color:red>+</p>': '+',
      '<p style= color:green>-</p>': '-', '<p> </p>': '', '<p>X</p>': 'X' };
    if (!Object.hasOwn(signs, row[9])) reject();
    const sign = signs[row[9]], change = parseFinancialNumber(row[10]);
    if (sign === '' && change !== null && change !== 0) reject();
    return { Code: row[0], Name: row[1], Date: day, TradeVolume: row[2], Transaction: row[3], TradeValue: row[4],
      OpeningPrice: row[5], HighestPrice: row[6], LowestPrice: row[7], ClosingPrice: row[8],
      Change: sign === 'X' ? 'X' : change === null ? null : `${sign}${change}` };
  });
  return { ...complete(parseQuoteRows(rows, fetchedAt)), source: QUOTE_FALLBACK_SOURCE };
}
async function officialJson(url, { fetchImpl, now, timeout }) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(url, { redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw Error();
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length; if (size > 4 * 1024 * 1024) { controller.abort(); throw Error(); } chunks.push(chunk);
    }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return { payload: JSON.parse(raw), fetchedAt: isoInstant(now()), sha256: hash(raw), url };
  } catch { throw Error('twse_request_failed'); }
  finally { controller.abort(); clearTimeout(timer); }
}
export async function fetchLatestQuotes({ previous = null, fetchImpl = fetch, now = nowMs, timeout = CACHE_POLICY.timeout } = {}) {
  const start = now(), today = taipeiDate(start), afterClose = start >= taipeiStartOfDay(today) + (17 * 60 + 17) * 60000;
  const options = { fetchImpl, now, timeout };
  const [primaryResult, marketResult] = await Promise.allSettled([
    officialJson(QUOTE_SOURCE, options), officialJson(quoteReportUrl(QUOTE_MARKET_SOURCE, today), options),
  ]);
  if (marketResult.status !== 'fulfilled') throw Error('twse_market_unverified');
  const publication = marketResult.value;
  let market = publication, days = parseMarketDays(market.payload, today, start), marketDate = today;
  const latestPublished = days.at(-1);
  let eligible = days.filter(day => day < today || afterClose).at(-1);
  if (!eligible) {
    marketDate = addCalendarDays(today.slice(0, 7) + '-01', -1);
    market = await officialJson(quoteReportUrl(QUOTE_MARKET_SOURCE, marketDate), options);
    days = parseMarketDays(market.payload, marketDate, start); eligible = days.at(-1);
  }
  if (!eligible) throw Error('twse_market_unverified');
  let primary = null;
  if (primaryResult.status === 'fulfilled') {
    try { primary = { ...complete(parseQuoteRows(primaryResult.value.payload, primaryResult.value.fetchedAt)), sha256: primaryResult.value.sha256 }; }
    catch { /* Invalid primary can never become a candidate. */ }
  }
  // FMTQIK can lag MI_INDEX. Probe possible closed weekdays, newest first.
  // A query date is not evidence: only a complete, exactly dated report proves publication.
  const cap = afterClose ? today : addCalendarDays(today, -1);
  let dateProof = null, proven = null;
  for (let offset = 0; offset < 7; offset++) {
    const day = addCalendarDays(cap, -offset);
    if (day <= eligible) break;
    if ([0, 6].includes(calendarWeekday(day))) continue;
    const report = await officialJson(quoteReportUrl(QUOTE_FALLBACK_SOURCE, day), options);
    if (report.payload?.stat === '很抱歉，沒有符合條件的資料!' && report.payload.tables == null) continue;
    proven = { ...parseMiIndex(report.payload, day, report.fetchedAt), sha256: report.sha256 };
    dateProof = { tradeDate: day, url: report.url, sha256: report.sha256, fetchedAt: report.fetchedAt };
    eligible = day; break;
  }
  // Do not call an arbitrarily old calendar 'latest' after an incomplete bounded search.
  if (!proven && addCalendarDays(cap, -6) > eligible) throw Error('twse_publication_unverified');
  if (primary && primary.tradeDate > eligible && !(primary.tradeDate === today && !afterClose)) throw Error('twse_publication_unverified');
  let candidate = primary?.tradeDate === eligible ? primary : null;
  if (proven && (!candidate || compareSnapshots('quotes', proven, candidate) > 0)) candidate = proven;
  if (!candidate) {
    const fallback = await officialJson(quoteReportUrl(QUOTE_FALLBACK_SOURCE, eligible), options);
    const parsed = { ...parseMiIndex(fallback.payload, eligible, fallback.fetchedAt), sha256: fallback.sha256 };
    candidate = !primary || primary.tradeDate > eligible || compareSnapshots('quotes', parsed, primary) >= 0 ? parsed : primary;
  }
  if (candidate.tradeDate !== eligible || previous && compareSnapshots('quotes', candidate, validateQuoteSnapshot(previous)) < 0) throw Error('twse_regression_refused');
  if (taipeiDate(now()) !== today) throw Error('twse_window_changed');
  candidate.evidence = { version: 1, method: candidate.source === QUOTE_SOURCE ? 'twse-openapi' : 'twse-mi-index',
    dataUrl: candidate.source === QUOTE_SOURCE ? QUOTE_SOURCE : quoteReportUrl(QUOTE_FALLBACK_SOURCE, eligible),
    marketUrl: market.url, marketDate, latestPublishedTradeDate: [latestPublished ?? eligible, eligible].sort().at(-1),
    eligibleTradeDate: eligible, checkedAt: publication.fetchedAt, marketSha256: market.sha256,
    publicationUrl: publication.url, publicationSha256: publication.sha256,
    ...(dateProof ? { dateProof } : {}) };
  return validateQuoteSnapshot(candidate);
}

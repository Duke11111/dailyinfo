import { JSDOM, VirtualConsole } from 'jsdom';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXCHANGE_SOURCE, EXCHANGE_CSV, EXCHANGE_CLOSE, closeDownloadUrl, EXCHANGE_LICENSE, CURRENCY_NAMES, exchangeTime, validateExchangeSnapshot } from '../../src/services/exchange.js';
import { ExchangeUpdateError, exchangeNetworkError, exchangeMimeFailureCode } from './exchange-errors.mjs';

const missing = new Set(['', '-', '--', '0', '0.00000']);
export function parseBankRate(raw) {
  const text = String(raw).trim(); if (missing.has(text)) return null;
  if (!/^\d+(?:\.\d{1,5})?$/.test(text) || Number(text) <= 0 || Number(text) > 1000000) throw new ExchangeUpdateError('parse_error', '官方匯率數字異常。'); return Number(text);
}
export function parseBankExchange(csv, html, fetchedAt = new Date().toISOString()) {
  try { return parseExchange(csv, html, fetchedAt); }
  catch (error) { throw error instanceof ExchangeUpdateError ? error : new ExchangeUpdateError('parse_error'); }
}
function readBankPage(html, strict = false, dailyClose = false) {
  // Malformed server HTML/CSS must not reach the process console through jsdom.
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  try {
    const document = dom.window.document;
    if (dailyClose && document.documentElement.hasAttribute('lang') && !/^zh-tw$/i.test(document.documentElement.lang)) throw new ExchangeUpdateError('quote_time_error');
    const closeTimes = dailyClose ? [...document.querySelectorAll('p.text-info')].map(node => node.textContent.replace(/\s+/g, ' ').trim()).filter(text => text.startsWith('掛牌時間')) : [];
    if (dailyClose && (closeTimes.length !== 1 || ![...document.querySelectorAll('h1,h2,h3')].some(node => node.textContent.trim() === '歷史匯率收盤價'))) throw new ExchangeUpdateError('quote_time_error');
    const stamps = dailyClose ? [...closeTimes[0].matchAll(/^掛牌時間[：:]\s*(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2})$/g)]
      : [...document.body.textContent.matchAll(/牌價最新掛牌時間[：:]\s*(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2})/g)];
    const stamp = stamps[0]?.[1];
    if (!stamp) throw new ExchangeUpdateError('quote_time_error', '官方網頁未提供可驗證的牌告時間。');
    const quotedAt = stamp.replaceAll('/', '-').replace(' ', 'T') + ':00+08:00';
    let downloadUrl;
    if (dailyClose) {
      exchangeTime(quotedAt);
      const links = [...document.querySelectorAll('a[href]')].map(node => new URL(node.getAttribute('href'), EXCHANGE_CLOSE)).filter(url => url.pathname.startsWith('/xrt/fltxt/'));
      if (links.length !== 1 || links[0].href !== closeDownloadUrl(quotedAt.slice(0, 10))) throw new ExchangeUpdateError('parse_error');
      downloadUrl = links[0].href;
    }
    let scope = document;
    if (strict) {
      const title = document.title;
      if (document.doctype?.name !== 'html' || !/<\/table\s*>/i.test(html) || !/<\/body\s*>/i.test(html) || !/<\/html\s*>\s*$/i.test(html)
        || !title.includes('臺灣銀行') || !title.includes('牌告匯率') || stamps.length !== 1
        || /captcha|access denied|just a moment|驗證碼|存取遭拒|機器人驗證/i.test(document.body.textContent)
        || document.querySelector('meta[http-equiv="refresh" i]')) throw new ExchangeUpdateError('parse_error');
      const tables = [...document.querySelectorAll('table')].filter(table => table.querySelector('td[data-table="本行現金買入"]'));
      if (tables.length !== 1) throw new ExchangeUpdateError('parse_error');
      scope = tables[0];
      const heads = [...scope.querySelectorAll('thead th')], label = node => node.textContent.replace(/\s+/g, '').trim();
      const cash = heads.findIndex(node => label(node) === '現金匯率' && node.getAttribute('colspan') === '2');
      const spot = heads.findIndex(node => label(node) === '即期匯率' && node.getAttribute('colspan') === '2');
      const sides = heads.map(label).filter(text => ['本行買入', '本行賣出'].includes(text));
      if (!heads.some(node => label(node) === '幣別') || cash < 0 || spot <= cash
        || sides.join(',') !== '本行買入,本行賣出,本行買入,本行賣出'
        || !scope.querySelector('tbody')) throw new ExchangeUpdateError('parse_error');
    }
    const table = new Map();
    const keys = ['本行現金買入', '本行現金賣出', '本行即期買入', '本行即期賣出'];
    for (const row of scope.querySelectorAll(strict ? 'tbody tr' : 'tr')) {
      if (!strict && !row.querySelector('td[data-table="本行現金買入"]')) continue;
      const label = (row.querySelector('td .hidden-phone') ?? row.querySelector('td')).textContent.replace(/\s+/g, ' ').trim();
      const match = label.match(/^(.+?)\s*\(([A-Z]{3})\)$/); if (!match || table.has(match[2])) throw new ExchangeUpdateError('parse_error', '官方網頁幣別格式異常。');
      if (strict && (!Object.hasOwn(CURRENCY_NAMES, match[2]) || ![CURRENCY_NAMES[match[2]], match[2] === 'USD' ? '美金' : ''].filter(Boolean).includes(match[1].trim())
        || [...row.querySelectorAll('td[data-table]')].map(cell => cell.getAttribute('data-table')).filter(name => keys.includes(name)).join(',') !== keys.join(','))) throw new ExchangeUpdateError('parse_error');
      const fields = keys.map(name => {
        const cells = row.querySelectorAll(`td[data-table="${name}"]`); if (cells.length !== 1) throw new ExchangeUpdateError('parse_error', '官方網頁匯率欄位缺失。');
        if (strict && !cells[0].textContent.trim()) throw new ExchangeUpdateError('parse_error');
        return parseBankRate(cells[0].textContent);
      }); table.set(match[2], { name: match[1].trim(), fields });
    }
    if (strict && table.size !== Object.keys(CURRENCY_NAMES).length) throw new ExchangeUpdateError('parse_error');
    return { quotedAt, table, ...(dailyClose ? { downloadUrl } : {}) };
  } finally { dom.window.close(); }
}
export function readBankClosePage(html) {
  try { return readBankPage(html, true, true); }
  catch (error) { throw error instanceof ExchangeUpdateError ? error : new ExchangeUpdateError('parse_error'); }
}
const txtHeader = ['幣別', '匯率', '現金', '即期', '遠期10天', '遠期30天', '遠期60天', '遠期90天', '遠期120天', '遠期150天', '遠期180天', '匯率', '現金', '即期', '遠期10天', '遠期30天', '遠期60天', '遠期90天', '遠期120天', '遠期150天', '遠期180天'];
export function parseBankDailyClose(html, txt, downloadUrl, fetchedAt = new Date().toISOString()) {
  try {
    const page = readBankClosePage(html);
    if (downloadUrl !== page.downloadUrl) throw new ExchangeUpdateError('parse_error');
    const rows = txt.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => line.trim().split(/\s+/));
    if (rows.shift()?.join(',') !== txtHeader.join(',') || rows.length !== 19) throw new ExchangeUpdateError('parse_error');
    const seen = new Set();
    for (const row of rows) {
      if (row.length !== 21 || seen.has(row[0]) || !page.table.has(row[0]) || row[1] !== '本行買入' || row[11] !== '本行賣出'
        || [...row.slice(2, 11), ...row.slice(12)].some(value => !/^\d+(?:\.\d{1,5})?$/.test(value))) throw new ExchangeUpdateError('parse_error');
      seen.add(row[0]);
      const fields = [row[2], row[12], row[3], row[13]].map(parseBankRate);
      if (fields.some((value, index) => value !== page.table.get(row[0]).fields[index])) throw new ExchangeUpdateError('parse_error');
    }
    const rates = [...page.table].map(([code, { name, fields }]) => ({ code, name, cash: { buy: fields[0], sell: fields[1] }, spot: { buy: fields[2], sell: fields[3] } }));
    return validateExchangeSnapshot({ ...snapshotBase(page.quotedAt, fetchedAt, rates, {
      mode: 'html-txt', validation: 'daily-close-19-v1', htmlSha256: createHash('sha256').update(html).digest('hex'), txtSha256: createHash('sha256').update(txt).digest('hex'),
    }), mode: 'daily-close', dataDate: page.quotedAt.slice(0, 10), sourceUrl: EXCHANGE_CLOSE, downloadUrl });
  } catch (error) { throw error instanceof ExchangeUpdateError ? error : new ExchangeUpdateError('parse_error'); }
}
const snapshotBase = (quotedAt, fetchedAt, rates, evidence) => ({ version: 1, source: '臺灣銀行', sourceUrl: EXCHANGE_SOURCE, downloadUrl: EXCHANGE_CSV, licenseUrl: EXCHANGE_LICENSE, base: 'TWD', unit: 1, quotedAt, fetchedAt, rates, evidence });
export function parseBankHtml(html, fetchedAt = new Date().toISOString()) {
  try {
    const { quotedAt, table } = readBankPage(html, true);
    const rates = [...table].map(([code, { name, fields }]) => ({ code, name, cash: { buy: fields[0], sell: fields[1] }, spot: { buy: fields[2], sell: fields[3] } }));
    return validateExchangeSnapshot(snapshotBase(quotedAt, fetchedAt, rates, { mode: 'html-only', reason: 'csv_text_html', validation: 'official-table-19-v1', htmlSha256: createHash('sha256').update(html).digest('hex') }));
  } catch (error) { throw error instanceof ExchangeUpdateError ? error : new ExchangeUpdateError('parse_error'); }
}
function parseExchange(csv, html, fetchedAt) {
  const rows = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => line.split(',').map(value => value.trim()));
  const header = rows.shift();
  if (header?.[0] !== '幣別' || header[1] !== '匯率' || header[2] !== '現金' || header[3] !== '即期' || header[11] !== '匯率' || header[12] !== '現金' || header[13] !== '即期' || !rows.length) throw new ExchangeUpdateError('csv_format_error', '官方 CSV 欄位異常，停止更新。');
  const { quotedAt, table } = readBankPage(html);
  const rates = rows.map(row => {
    if (row.length < 21 || row.length > 22 || (row.length === 22 && row[21] !== '') || row[1] !== '本行買入' || row[11] !== '本行賣出') throw new ExchangeUpdateError('csv_format_error', '官方 CSV 買賣欄位異常。');
    const code = row[0], page = table.get(code), values = [row[2], row[12], row[3], row[13]].map(parseBankRate);
    if (!page || values.some((value, i) => value !== page.fields[i])) throw new ExchangeUpdateError('csv_html_mismatch', 'CSV 與官方網頁報價不一致，可能更新中；保留舊快照。');
    return { code, name: page.name, cash: { buy: values[0], sell: values[1] }, spot: { buy: values[2], sell: values[3] } };
  });
  if (rates.length !== table.size) throw new ExchangeUpdateError('csv_html_mismatch', 'CSV 與網頁幣別範圍不一致。');
  return validateExchangeSnapshot(snapshotBase(quotedAt, fetchedAt, rates, { csvSha256: createHash('sha256').update(csv).digest('hex'), htmlSha256: createHash('sha256').update(html).digest('hex') }));
}
export async function updateExchange({ target = new URL('../../public/data/exchange.json', import.meta.url), fetchImpl = fetch, now = Date.now, allowHtmlFallback = false, mode = 'legacy' } = {}) {
  if (!['legacy', 'daily-close'].includes(mode)) throw new ExchangeUpdateError('parse_error');
  // At most two ordinary official requests, no retries, proxy, browser evasion or polling.
  const get = async (url, type, endpoint) => {
    let response;
    try { response = await fetchImpl(url, { signal: AbortSignal.timeout(20000), redirect: 'manual' }); }
    catch (error) { throw exchangeNetworkError(error); }
    // Inspect redirect status without following it or logging Location / headers / body.
    if (response.status >= 300 && response.status < 400) throw new ExchangeUpdateError('redirect_error');
    if (!response.ok) throw new ExchangeUpdateError(response.status === 403 ? 'http_403' : response.status === 429 ? 'http_429' : response.status >= 500 && response.status <= 599 ? 'http_5xx' : 'http_error');
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.split(';')[0].trim().toLowerCase() !== type) throw new ExchangeUpdateError(exchangeMimeFailureCode(endpoint, contentType));
    const charset = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
    if (charset && !/^(?:utf-?8|us-ascii)$/i.test(charset)) throw new ExchangeUpdateError('encoding_error');
    let text;
    try { text = await response.text(); } catch (error) { throw exchangeNetworkError(error); }
    if (text.length > 2000000) throw new ExchangeUpdateError('response_too_large');
    if (text.includes('\uFFFD')) throw new ExchangeUpdateError('encoding_error');
    return text;
  };
  let snapshot;
  if (mode === 'daily-close') {
    const html = await get(EXCHANGE_CLOSE, 'text/html', 'html'), page = readBankClosePage(html);
    if (Date.parse(page.quotedAt) > now() + 60000) throw new ExchangeUpdateError('quote_time_error');
    const txt = await get(page.downloadUrl, 'text/plain', 'txt');
    snapshot = parseBankDailyClose(html, txt, page.downloadUrl, new Date(now()).toISOString());
  } else {
    let csv;
    try { csv = await get(EXCHANGE_CSV, 'text/csv', 'csv'); }
    catch (error) {
      if (allowHtmlFallback !== true || !(error instanceof ExchangeUpdateError) || error.safeCode !== 'unexpected_content_type_csv_text_html') throw error;
    }
    const html = await get(EXCHANGE_SOURCE, 'text/html', 'html');
    snapshot = csv === undefined ? parseBankHtml(html, new Date(now()).toISOString()) : parseBankExchange(csv, html, new Date(now()).toISOString());
  }
  let previous;
  try { previous = validateExchangeSnapshot(JSON.parse(await readFile(target, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw new ExchangeUpdateError('previous_snapshot_invalid'); }
  if (previous && (snapshot.quotedAt < previous.quotedAt || snapshot.fetchedAt < previous.fetchedAt)) throw new ExchangeUpdateError('date_regression');
  if (previous && snapshot.quotedAt === previous.quotedAt && JSON.stringify([...snapshot.rates].sort((a, b) => a.code.localeCompare(b.code))) !== JSON.stringify([...previous.rates].sort((a, b) => a.code.localeCompare(b.code)))) throw new ExchangeUpdateError('date_regression');
  try {
    await mkdir(dirname(target instanceof URL ? fileURLToPath(target) : target), { recursive: true });
    const temporary = target instanceof URL ? new URL(target.href + '.tmp') : `${target}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n'); await rename(temporary, target); return snapshot;
  } catch { throw new ExchangeUpdateError('filesystem_error'); }
}

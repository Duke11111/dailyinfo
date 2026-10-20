import { JSDOM, VirtualConsole } from 'jsdom';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXCHANGE_SOURCE, EXCHANGE_CSV, EXCHANGE_LICENSE, validateExchangeSnapshot } from '../../src/services/exchange.js';
import { ExchangeUpdateError, exchangeNetworkError } from './exchange-errors.mjs';

const missing = new Set(['', '-', '--', '0', '0.00000']);
export function parseBankRate(raw) {
  const text = String(raw).trim(); if (missing.has(text)) return null;
  if (!/^\d+(?:\.\d{1,5})?$/.test(text) || Number(text) <= 0 || Number(text) > 1000000) throw new ExchangeUpdateError('parse_error', '官方匯率數字異常。'); return Number(text);
}
export function parseBankExchange(csv, html, fetchedAt = new Date().toISOString()) {
  try { return parseExchange(csv, html, fetchedAt); }
  catch (error) { throw error instanceof ExchangeUpdateError ? error : new ExchangeUpdateError('parse_error'); }
}
function parseExchange(csv, html, fetchedAt) {
  const rows = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => line.split(',').map(value => value.trim()));
  const header = rows.shift();
  if (header?.[0] !== '幣別' || header[1] !== '匯率' || header[2] !== '現金' || header[3] !== '即期' || header[11] !== '匯率' || header[12] !== '現金' || header[13] !== '即期' || !rows.length) throw new ExchangeUpdateError('csv_format_error', '官方 CSV 欄位異常，停止更新。');
  // Malformed server HTML/CSS must not reach the process console through jsdom.
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  try {
    const document = dom.window.document;
    const stamp = document.body.textContent.match(/牌價最新掛牌時間[：:]\s*(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2})/)?.[1];
    if (!stamp) throw new ExchangeUpdateError('quote_time_error', '官方網頁未提供可驗證的牌告時間。');
    const quotedAt = stamp.replaceAll('/', '-').replace(' ', 'T') + ':00+08:00';
    const table = new Map();
    for (const row of document.querySelectorAll('tr')) {
      if (!row.querySelector('td[data-table="本行現金買入"]')) continue;
      const label = (row.querySelector('td .hidden-phone') ?? row.querySelector('td')).textContent.replace(/\s+/g, ' ').trim();
      const match = label.match(/^(.+?)\s*\(([A-Z]{3})\)$/); if (!match || table.has(match[2])) throw new ExchangeUpdateError('parse_error', '官方網頁幣別格式異常。');
      const fields = ['本行現金買入', '本行現金賣出', '本行即期買入', '本行即期賣出'].map(name => {
        const cell = row.querySelector(`td[data-table="${name}"]`); if (!cell) throw new ExchangeUpdateError('parse_error', '官方網頁匯率欄位缺失。'); return parseBankRate(cell.textContent);
      }); table.set(match[2], { name: match[1].trim(), fields });
    }
    const rates = rows.map(row => {
      if (row.length < 21 || row.length > 22 || (row.length === 22 && row[21] !== '') || row[1] !== '本行買入' || row[11] !== '本行賣出') throw new ExchangeUpdateError('csv_format_error', '官方 CSV 買賣欄位異常。');
      const code = row[0], page = table.get(code), values = [row[2], row[12], row[3], row[13]].map(parseBankRate);
      if (!page || values.some((value, i) => value !== page.fields[i])) throw new ExchangeUpdateError('csv_html_mismatch', 'CSV 與官方網頁報價不一致，可能更新中；保留舊快照。');
      return { code, name: page.name, cash: { buy: values[0], sell: values[1] }, spot: { buy: values[2], sell: values[3] } };
    });
    if (rates.length !== table.size) throw new ExchangeUpdateError('csv_html_mismatch', 'CSV 與網頁幣別範圍不一致。');
    return validateExchangeSnapshot({ version: 1, source: '臺灣銀行', sourceUrl: EXCHANGE_SOURCE, downloadUrl: EXCHANGE_CSV, licenseUrl: EXCHANGE_LICENSE, base: 'TWD', unit: 1, quotedAt, fetchedAt, rates, evidence: { csvSha256: createHash('sha256').update(csv).digest('hex'), htmlSha256: createHash('sha256').update(html).digest('hex') } });
  } finally { dom.window.close(); }
}
export async function updateExchange({ target = new URL('../../public/data/exchange.json', import.meta.url), fetchImpl = fetch, now = Date.now } = {}) {
  // At most two ordinary official requests, no retries, proxy, browser evasion or polling.
  const get = async (url, type) => {
    let response;
    try { response = await fetchImpl(url, { signal: AbortSignal.timeout(20000), redirect: 'manual' }); }
    catch (error) { throw exchangeNetworkError(error); }
    // Inspect redirect status without following it or logging Location / headers / body.
    if (response.status >= 300 && response.status < 400) throw new ExchangeUpdateError('redirect_error');
    if (!response.ok) throw new ExchangeUpdateError(response.status === 403 ? 'http_403' : response.status === 429 ? 'http_429' : response.status >= 500 && response.status <= 599 ? 'http_5xx' : 'http_error');
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.split(';')[0].trim().toLowerCase() !== type) throw new ExchangeUpdateError('unexpected_content_type');
    const charset = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
    if (charset && !/^(?:utf-?8|us-ascii)$/i.test(charset)) throw new ExchangeUpdateError('encoding_error');
    let text;
    try { text = await response.text(); } catch (error) { throw exchangeNetworkError(error); }
    if (text.length > 2000000) throw new ExchangeUpdateError('response_too_large');
    if (text.includes('\uFFFD')) throw new ExchangeUpdateError('encoding_error');
    return text;
  };
  const csv = await get(EXCHANGE_CSV, 'text/csv'), html = await get(EXCHANGE_SOURCE, 'text/html');
  const snapshot = parseBankExchange(csv, html, new Date(now()).toISOString());
  let previous;
  try { previous = validateExchangeSnapshot(JSON.parse(await readFile(target, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw new ExchangeUpdateError('previous_snapshot_invalid'); }
  if (previous && (snapshot.quotedAt < previous.quotedAt || snapshot.fetchedAt < previous.fetchedAt)) throw new ExchangeUpdateError('date_regression');
  try {
    await mkdir(dirname(target instanceof URL ? fileURLToPath(target) : target), { recursive: true });
    const temporary = target instanceof URL ? new URL(target.href + '.tmp') : `${target}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n'); await rename(temporary, target); return snapshot;
  } catch { throw new ExchangeUpdateError('filesystem_error'); }
}

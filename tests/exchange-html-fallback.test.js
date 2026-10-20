import { it, expect, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { parseBankHtml, updateExchange } from '../scripts/lib/exchange-import.mjs';
import { validateExchangeSnapshot, EXCHANGE_CSV, EXCHANGE_SOURCE } from '../src/services/exchange.js';
import { exchangeCsv, exchangeCaptured, fullExchangeFixture, fullExchangeHtml } from './fixtures/exchange.js';
import { exchangeExitStatus, exchangeCodeFromExitStatus } from '../scripts/lib/exchange-errors.mjs';

const clock = () => Date.parse(exchangeCaptured);
const response = (type, text, status = 200) => ({ status, ok: status === 200, headers: new Headers({ 'content-type': type }), text: vi.fn(async () => text) });
const fetcher = (html = fullExchangeHtml()) => vi.fn(async url => url === EXCHANGE_CSV ? response('text/html', 'untrusted CSV-endpoint body') : response('text/html; charset=utf-8', html));
async function withFile(test) {
  const base = resolve('.cache/exchange-html-tests'); await mkdir(base, { recursive: true });
  const folder = await mkdtemp(join(base, 'case-')), target = join(folder, 'exchange.json');
  const previous = JSON.stringify(fullExchangeFixture()); await writeFile(target, previous);
  try { await test(target, previous); }
  finally { if (!resolve(folder).startsWith(base + sep)) throw Error('unsafe cleanup'); await rm(folder, { recursive: true }); }
}
it('parses all 19 currencies and four bank sides, preserving explicit missing quotes and honest evidence', () => {
  const data = parseBankHtml(fullExchangeHtml(), exchangeCaptured);
  expect(data.rates).toEqual(fullExchangeFixture().rates);
  expect(data.rates.find(rate => rate.code === 'KRW').spot).toEqual({ buy: null, sell: null });
  expect(data.evidence).toEqual({ mode: 'html-only', reason: 'csv_text_html', validation: 'official-table-19-v1', htmlSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(validateExchangeSnapshot(data).evidence).toEqual(data.evidence);
  expect(data.quotedAt).toBe('2026-10-20T00:42:00+08:00');
});
it('uses only the separate official page after the known CSV MIME mismatch, with two GETs and no body reuse', async () => withFile(async target => {
  const wrong = response('text/html', fullExchangeHtml()); wrong.text.mockImplementation(() => { throw Error('CSV HTML body must not be read'); });
  const fetchImpl = vi.fn(async url => url === EXCHANGE_CSV ? wrong : response('text/html', fullExchangeHtml()));
  const data = await updateExchange({ target, fetchImpl, now: clock, allowHtmlFallback: true });
  expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([EXCHANGE_CSV, EXCHANGE_SOURCE]);
  expect(fetchImpl.mock.calls.every(([, options]) => options.redirect === 'manual')).toBe(true);
  expect(wrong.text).not.toHaveBeenCalled(); expect(data.evidence.mode).toBe('html-only');
  expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(data);
}));
it('requires explicit fallback opt-in', async () => withFile(async (target, previous) => {
  const fetchImpl = fetcher(); await expect(updateExchange({ target, fetchImpl, now: clock })).rejects.toMatchObject({ safeCode: 'unexpected_content_type_csv_text_html' });
  expect(fetchImpl).toHaveBeenCalledTimes(1); expect(await readFile(target, 'utf8')).toBe(previous);
}));
const badPages = [
  ['truncated document', html => html.replace('</body></html>', '')],
  ['wrong title', html => html.replace('<title>臺灣銀行牌告匯率</title>', '<title>Error</title>')],
  ['missing table header', html => html.replace(/<thead>.*?<\/thead>/, '')],
  ['missing currency', () => fullExchangeHtml({ ...fullExchangeFixture(), rates: fullExchangeFixture().rates.slice(1) })],
  ['duplicate currency', () => fullExchangeHtml({ ...fullExchangeFixture(), rates: [...fullExchangeFixture().rates.slice(0, -1), fullExchangeFixture().rates[0]] })],
  ['wrong currency name', html => html.replace('美元 (USD)', '日圓 (USD)')],
  ['missing field', html => html.replace('<td data-table="本行現金買入">1</td>', '')],
  ['duplicate field', html => html.replace('<td data-table="本行現金買入">1</td>', '<td data-table="本行現金買入">1</td><td data-table="本行現金買入">1</td>')],
  ['empty field', html => html.replace('本行現金買入">1<', '本行現金買入"><')],
  ['invalid price', html => html.replace('本行現金買入">1<', '本行現金買入">NaN<')],
  ['buy exceeds sell', html => html.replace('本行現金買入">1<', '本行現金買入">99<')],
  ['missing quote time', html => html.replace('牌價最新掛牌時間', 'unknown')],
  ['duplicate quote time', html => html + '<span>牌價最新掛牌時間：2026/10/20 00:42</span>'],
  ['invalid date', html => html.replace('2026/10/20', '2026/02/30')],
  ['future date', html => html.replace('2026/10/20', '2026/10/21')],
  ['protection page', () => '<!doctype html><title>Just a moment</title><body>Access denied private-test-value</body>'],
  ['challenge added to table', html => html.replace('<body>', '<body><div>CAPTCHA private-test-value</div>')],
  ['refresh redirect page', html => html.replace('<head>', '<head><meta http-equiv="refresh" content="0">')],
];
it.each(badPages)('rejects %s without replacing any of the old 19 currencies', async (_name, mutate) => withFile(async (target, previous) => {
  const error = await updateExchange({ target, fetchImpl: fetcher(mutate(fullExchangeHtml())), now: clock, allowHtmlFallback: true }).catch(error => error);
  expect(error.safeCode).toMatch(/^(parse_error|quote_time_error)$/);
  expect(exchangeCodeFromExitStatus(exchangeExitStatus(error))).toBe(error.safeCode);
  expect(error.message).not.toContain('private-test-value'); expect(await readFile(target, 'utf8')).toBe(previous);
}));
it('rejects date regression and preserves the complete old snapshot', async () => withFile(async (target, previous) => {
  await expect(updateExchange({ target, fetchImpl: fetcher(fullExchangeHtml().replace('2026/10/20', '2026/10/19')), now: clock, allowHtmlFallback: true })).rejects.toMatchObject({ safeCode: 'date_regression' });
  expect(await readFile(target, 'utf8')).toBe(previous);
}));
it.each(['text/plain', 'application/json', '', 'application/octet-stream'])('does not fall back for CSV MIME %s', async type => withFile(async (target, previous) => {
  const fetchImpl = vi.fn(async () => response(type, 'private-test-value'));
  await expect(updateExchange({ target, fetchImpl, now: clock, allowHtmlFallback: true })).rejects.toHaveProperty('safeCode');
  expect(fetchImpl).toHaveBeenCalledTimes(1); expect(await readFile(target, 'utf8')).toBe(previous);
}));
it.each([403, 429, 302, 503])('does not fall back or retry CSV HTTP %s', async status => withFile(async (target, previous) => {
  const fetchImpl = vi.fn(async () => response('text/html', 'private-test-value', status));
  await expect(updateExchange({ target, fetchImpl, now: clock, allowHtmlFallback: true })).rejects.toHaveProperty('safeCode');
  expect(fetchImpl).toHaveBeenCalledTimes(1); expect(await readFile(target, 'utf8')).toBe(previous);
}));
it('keeps strict CSV/HTML comparison when CSV is available, even with fallback enabled', async () => withFile(async (target, previous) => {
  const fetchImpl = vi.fn(async url => url === EXCHANGE_CSV ? response('text/csv', exchangeCsv(fullExchangeFixture()).replace('1.00000', '0.90000')) : response('text/html', fullExchangeHtml()));
  await expect(updateExchange({ target, fetchImpl, now: clock, allowHtmlFallback: true })).rejects.toMatchObject({ safeCode: 'csv_html_mismatch' });
  expect(fetchImpl).toHaveBeenCalledTimes(2); expect(await readFile(target, 'utf8')).toBe(previous);
}));
it('does not bypass a malformed CSV or accept its MIME as permission to ignore parsing', async () => withFile(async (target, previous) => {
  const fetchImpl = vi.fn(async url => url === EXCHANGE_CSV ? response('text/csv', 'invalid CSV') : response('text/html', fullExchangeHtml()));
  await expect(updateExchange({ target, fetchImpl, now: clock, allowHtmlFallback: true })).rejects.toMatchObject({ safeCode: 'csv_format_error' });
  expect(fetchImpl).toHaveBeenCalledTimes(2); expect(await readFile(target, 'utf8')).toBe(previous);
}));
it.each([
  ['http_403', () => response('text/html', 'private-test-value', 403)],
  ['redirect_error', () => response('text/html', 'private-test-value', 302)],
  ['unexpected_content_type_html_application_json', () => response('application/json', 'private-test-value')],
  ['encoding_error', () => response('text/html; charset=big5', fullExchangeHtml())],
  ['response_too_large', () => response('text/html', 'a'.repeat(2000001))],
])('preserves old snapshot when the separate HTML request fails with %s', async (code, make) => withFile(async (target, previous) => {
  const fetchImpl = vi.fn(async url => url === EXCHANGE_CSV ? response('text/html', 'discarded') : make());
  await expect(updateExchange({ target, fetchImpl, now: clock, allowHtmlFallback: true })).rejects.toMatchObject({ safeCode: code });
  expect(fetchImpl).toHaveBeenCalledTimes(2); expect(await readFile(target, 'utf8')).toBe(previous);
}));
it('preserves CSV hashes on a normal CSV path instead of claiming HTML fallback', async () => withFile(async target => {
  const fetchImpl = vi.fn(async url => url === EXCHANGE_CSV ? response('text/csv', exchangeCsv(fullExchangeFixture())) : response('text/html', fullExchangeHtml()));
  const data = await updateExchange({ target, fetchImpl, now: clock, allowHtmlFallback: true });
  expect(data.evidence.csvSha256).toMatch(/^[a-f0-9]{64}$/); expect(data.evidence.mode).toBeUndefined();
}));
it('rejects fabricated CSV evidence attached to an HTML-only snapshot', () => {
  const data = parseBankHtml(fullExchangeHtml(), exchangeCaptured); data.evidence.csvSha256 = 'a'.repeat(64);
  expect(() => validateExchangeSnapshot(data)).toThrow('證據');
});
it('never executes scripts or loads page resources while parsing the official-page structure', () => {
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('forbidden external request'));
  try {
    const html = fullExchangeHtml().replace('</body>', '<script>throw Error("private-test-value")</script><img src="https://untrusted.test/pixel"></body>');
    expect(parseBankHtml(html, exchangeCaptured).rates).toHaveLength(19); expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});

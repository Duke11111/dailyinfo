import { it, expect, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { parseBankDailyClose, readBankClosePage, updateExchange } from '../scripts/lib/exchange-import.mjs';
import { EXCHANGE_CLOSE, EXCHANGE_CLOSE_LEGACY, closeDownloadUrl, validateExchangeSnapshot } from '../src/services/exchange.js';
import { closeFixture, closeHtml, closeTxt, closeCaptured, exchangeFixture } from './fixtures/exchange.js';
const url = closeDownloadUrl('2026-10-20'), clock = () => Date.parse(closeCaptured);
const parse = (html = closeHtml(), txt = closeTxt(), download = url) => parseBankDailyClose(html, txt, download, closeCaptured);
const response = (type, text) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': type }), text: async () => text });
const fetcher = (html = closeHtml(), txt = closeTxt()) => vi.fn(async link => response(link === EXCHANGE_CLOSE ? 'text/html; charset=utf-8' : 'text/plain', link === EXCHANGE_CLOSE ? html : txt));
async function withTarget(test) {
  const base = resolve('.cache/exchange-close-tests'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'case-')), target = join(dir, 'exchange.json'), before = JSON.stringify(exchangeFixture()); await writeFile(target, before);
  try { await test(target, before); } finally { if (!resolve(dir).startsWith(base + sep)) throw Error('unsafe cleanup'); await rm(dir, { recursive: true }); }
}
it('correlates 19 currencies and 76 values with a date-specific official TXT, not retrieval time', () => {
  const s = parse(); expect(s.rates).toEqual(closeFixture().rates);
  expect(s).toMatchObject({ mode: 'daily-close', dataDate: '2026-10-20', sourceUrl: EXCHANGE_CLOSE, downloadUrl: url, quotedAt: '2026-10-20T16:01:00+08:00', fetchedAt: closeCaptured });
  expect(s.evidence).toEqual({ mode: 'html-txt', validation: 'daily-close-19-v1', htmlSha256: expect.stringMatching(/^[a-f0-9]{64}$/), txtSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(s.evidence.csvSha256).toBeUndefined(); expect(s.rates.find(r => r.code === 'KRW').spot).toEqual({ buy: null, sell: null });
  expect(validateExchangeSnapshot(s)).toEqual(s);
});
it('requests only the close page followed by its exact dated TXT and never CSV or latest TXT', async () => withTarget(async target => {
  const fetchImpl = fetcher(); const s = await updateExchange({ mode: 'daily-close', target, fetchImpl, now: clock });
  expect(fetchImpl.mock.calls.map(([u]) => u)).toEqual([EXCHANGE_CLOSE, url]);
  expect(fetchImpl.mock.calls.every(([, options]) => options.redirect === 'manual')).toBe(true);
  expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(s);
}));
it.each([
  ['missing currency', () => closeTxt({ ...closeFixture(), rates: closeFixture().rates.slice(1) })],
  ['duplicate currency', () => closeTxt({ ...closeFixture(), rates: [...closeFixture().rates.slice(0, -1), closeFixture().rates[0]] })],
  ['mismatched price', t => t.replace('1.00000', '0.90000')],
  ['swapped cash/spot', t => t.replace('1.00000   1.10000', '1.10000   1.00000')],
  ['header changed', t => t.replace('遠期10天', '即期')],
  ['missing side label', t => t.replace('本行買入', 'unknown')],
  ['extra column', t => t.replace('1.00000', '1.00000   2.00000')],
  ['untrusted HTML', () => '<html>Access denied</html>'],
  ['invalid number', t => t.replace('1.00000', 'NaN')],
])('refuses TXT %s and preserves the old snapshot', async (_name, mutate) => withTarget(async (target, before) => {
  const fetchImpl = fetcher(closeHtml(), mutate(closeTxt()));
  await expect(updateExchange({ mode: 'daily-close', target, fetchImpl, now: clock })).rejects.toMatchObject({ safeCode: 'parse_error' });
  expect(await readFile(target, 'utf8')).toBe(before); expect(fetchImpl).toHaveBeenCalledTimes(2);
}));
it.each([
  h => h.replace('/xrt/fltxt/0/2026-10-20', '/xrt/fltxt/0/2026-10-19'),
  h => h.replace('/xrt/fltxt/0/2026-10-20', '/xrt/fltxt/0/day'),
  h => h.replace('/xrt/fltxt/0/2026-10-20', 'https://untrusted.test/xrt/fltxt/0/2026-10-20'),
  h => h.replace('/xrt/fltxt/0/2026-10-20', '/xrt/fltxt/0/2026-10-20?untrusted=1'),
  h => h.replace('掛牌時間', 'unknown'),
  h => h.replace('歷史匯率收盤價', '最新匯率'),
  h => h.replace('2026/10/20', '2026/02/30'),
  h => h.replace('本行現金買入', 'unknown'),
  h => h.replace('</body>', '<p>CAPTCHA</p></body>'),
])('rejects invalid HTML/date/link before requesting TXT', async mutate => withTarget(async (target, before) => {
  const fetchImpl = fetcher(mutate(closeHtml()));
  await expect(updateExchange({ mode: 'daily-close', target, fetchImpl, now: clock })).rejects.toHaveProperty('safeCode');
  expect(fetchImpl).toHaveBeenCalledTimes(1); expect(await readFile(target, 'utf8')).toBe(before);
}));
it('rejects a TXT URL from another date even if all its values happen to match', () => {
  expect(() => parse(closeHtml(), closeTxt(), closeDownloadUrl('2026-10-19'))).toThrow();
});
it('refuses quote-date regression even with a later retrieval time', async () => withTarget(async (target, before) => {
  const older = { ...closeFixture(), quotedAt: '2026-10-19T16:01:00+08:00' };
  await expect(updateExchange({ mode: 'daily-close', target, fetchImpl: fetcher(closeHtml(older), closeTxt(older)), now: clock })).rejects.toMatchObject({ safeCode: 'date_regression' });
  expect(await readFile(target, 'utf8')).toBe(before);
}));
it('refuses changed values with the same official timestamp rather than trusting a later fetch', async () => withTarget(async target => {
  const before = JSON.stringify(parse()); await writeFile(target, before);
  const changed = closeFixture(); changed.rates[0].cash.buy = .9;
  await expect(updateExchange({ mode: 'daily-close', target, fetchImpl: fetcher(closeHtml(changed), closeTxt(changed)), now: () => clock() + 1000 })).rejects.toMatchObject({ safeCode: 'date_regression' });
  expect(await readFile(target, 'utf8')).toBe(before);
}));
it.each([['text/html', 'unexpected_content_type'], ['text/plain; charset=big5', 'encoding_error']])('refuses TXT MIME/encoding %s', async (mime, code) => withTarget(async (target, before) => {
  const fetchImpl = vi.fn(async link => link === EXCHANGE_CLOSE ? response('text/html', closeHtml()) : response(mime, closeTxt()));
  await expect(updateExchange({ mode: 'daily-close', target, fetchImpl, now: clock })).rejects.toMatchObject({ safeCode: code }); expect(await readFile(target, 'utf8')).toBe(before);
}));
it('refuses invalid UTF-8 replacement characters and future official timestamps', async () => withTarget(async (target, before) => {
  await expect(updateExchange({ mode: 'daily-close', target, fetchImpl: fetcher(closeHtml(), '\uFFFD'), now: clock })).rejects.toMatchObject({ safeCode: 'encoding_error' });
  const perform = fetcher(); await expect(updateExchange({ mode: 'daily-close', target, fetchImpl: perform, now: () => Date.parse('2026-10-19T00:00:00Z') })).rejects.toMatchObject({ safeCode: 'quote_time_error' });
  expect(perform).toHaveBeenCalledTimes(1); expect(await readFile(target, 'utf8')).toBe(before);
}));
it.each([
  s => { s.dataDate = '2026-10-19'; }, s => { s.downloadUrl = closeDownloadUrl('2026-10-19'); },
  s => { s.evidence.csvSha256 = 'a'.repeat(64); }, s => { delete s.evidence.txtSha256; },
  s => { s.rates.pop(); }, s => { delete s.mode; },
])('rejects inconsistent persisted close provenance', mutate => { const s = parse(); mutate(s); expect(() => validateExchangeSnapshot(s)).toThrow(); });
it('keeps legacy snapshots legacy instead of relabeling them daily close', () => { expect(validateExchangeSnapshot(exchangeFixture()).mode).toBeUndefined(); });
it('requests the explicit official Traditional Chinese page and preserves the dated TXT URL', async () => withTarget(async target => {
  const fetchImpl = fetcher(closeHtml().replace('<html>', '<html lang="zh-TW">'));
  const result = await updateExchange({ mode: 'daily-close', target, fetchImpl, now: clock });
  expect(fetchImpl.mock.calls.map(([u]) => u)).toEqual(['https://rate.bot.com.tw/xrt/all/day?Lang=zh-TW', url]);
  expect(result.sourceUrl).toBe(EXCHANGE_CLOSE); expect(result.downloadUrl).toBe(url);
}));
it.each([
  ['English heading and timestamp', h => h.replace('歷史匯率收盤價', 'Historical Foreign Exchange Rate - Closing Rate').replace('掛牌時間', 'Quoted Date')],
  ['declared English', h => h.replace('<html>', '<html lang="en-US">')],
  ['unexpected language', h => h.replace('<html>', '<html lang="ja">')],
  ['mixed English headers', h => h.replace('現金匯率', 'Cash Rate').replaceAll('本行買入', 'Bank Buying')],
])('rejects %s instead of accepting a timestamp-only language workaround', async (_name, mutate) => withTarget(async (target, before) => {
  const fetchImpl = fetcher(mutate(closeHtml()));
  await expect(updateExchange({ mode: 'daily-close', target, fetchImpl, now: clock })).rejects.toHaveProperty('safeCode');
  expect(fetchImpl).toHaveBeenCalledTimes(1); expect(await readFile(target, 'utf8')).toBe(before);
}));
it('reproduces quote_time_error from the supplied English heading/time pattern', () => {
  expect(() => readBankClosePage(closeHtml().replace('歷史匯率收盤價', 'Historical Foreign Exchange Rate - Closing Rate').replace('掛牌時間', 'Quoted Date'))).toThrow(expect.objectContaining({ safeCode: 'quote_time_error' }));
});
it('does not trust a specified language to make an older same-day quote newer', async () => withTarget(async target => {
  const before = JSON.stringify(parse()); await writeFile(target, before);
  const older = { ...closeFixture(), quotedAt: '2026-10-20T15:01:00+08:00' };
  const fetchImpl = fetcher(closeHtml(older), closeTxt(older));
  await expect(updateExchange({ mode: 'daily-close', target, fetchImpl, now: () => clock() + 60000 })).rejects.toMatchObject({ safeCode: 'date_regression' });
  expect(await readFile(target, 'utf8')).toBe(before);
}));
it('keeps existing no-language daily-close provenance valid without rewriting it', () => {
  const old = { ...parse(), sourceUrl: EXCHANGE_CLOSE_LEGACY };
  expect(validateExchangeSnapshot(old)).toEqual(old);
  expect(() => validateExchangeSnapshot({ ...old, sourceUrl: EXCHANGE_CLOSE_LEGACY + '?Lang=en-US' })).toThrow();
});
it('uses daily-close as the normal CLI entry while preserving explicit legacy library behavior', async () => {
  expect(await readFile('scripts/update-exchange.mjs', 'utf8')).toContain("mode: 'daily-close'");
  expect(readBankClosePage(closeHtml()).downloadUrl).toBe(url);
});

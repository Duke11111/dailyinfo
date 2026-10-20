import { it, expect, vi } from 'vitest';
import { mkdir, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { updateExchange } from '../scripts/lib/exchange-import.mjs';
import { exchangeFixture, exchangeCsv, exchangeHtml, exchangeCaptured } from './fixtures/exchange.js';
import { EXCHANGE_ERROR_CODES, EXCHANGE_MIME_CLASSES, ExchangeUpdateError, exchangeErrorCode, exchangeExitStatus, exchangeCodeFromExitStatus, classifyExchangeMime, exchangeMimeFailureCode } from '../scripts/lib/exchange-errors.mjs';
async function files(test) {
  const folder = new URL('../node_modules/.cache/', import.meta.url); await mkdir(folder, { recursive: true }); const target = new URL(`exchange-test-${randomUUID()}.json`, folder);
  try { await test(target); } finally { for (const path of [target, new URL(target.href + '.tmp')]) try { await unlink(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
const fakeFetch = (csv = exchangeCsv(), html = exchangeHtml()) => async url => ({ ok: true, headers: new Headers({ 'content-type': url.includes('flcsv') ? 'text/csv' : 'text/html' }), text: async () => url.includes('flcsv') ? csv : html });
it('writes a verified, timestamped snapshot that works without API keys', async () => files(async target => {
  const data = await updateExchange({ target, fetchImpl: fakeFetch(), now: () => Date.parse(exchangeCaptured) }); expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(data); expect(data.rates[3].spot.buy).toBeNull();
}));
it.each(['http', 'mismatch', 'older', 'invalid-json'])('preserves existing file bytes when update fails: %s', async scenario => files(async target => {
  const before = scenario === 'invalid-json' ? '{broken' : JSON.stringify(exchangeFixture()); await writeFile(target, before);
  const options = { target, now: () => Date.parse(exchangeCaptured), fetchImpl: scenario === 'http' ? async () => ({ ok: false }) : scenario === 'mismatch' ? fakeFetch(exchangeCsv().replace('32.00000', '31.00000')) : scenario === 'older' ? fakeFetch(exchangeCsv(), exchangeHtml().replace('2026/10/20', '2026/10/19')) : fakeFetch() };
  await expect(updateExchange(options)).rejects.toThrow(); expect(await readFile(target, 'utf8')).toBe(before);
}));

const failureCases = [
  ['dns_error', async () => { throw Object.assign(Error('private-test-value'), { cause: { code: 'ENOTFOUND' } }); }],
  ['tls_error', async () => { throw Object.assign(Error('private-test-value'), { cause: { code: 'CERT_HAS_EXPIRED' } }); }],
  ['connection_error', async () => { throw Object.assign(Error('private-test-value'), { cause: { code: 'ECONNREFUSED' } }); }],
  ['request_timeout', async () => { throw Object.assign(Error('private-test-value'), { name: 'TimeoutError' }); }],
  ['network_error', async () => { throw Error('private-test-value'); }],
  ...[[403, 'http_403'], [429, 'http_429'], [503, 'http_5xx'], [404, 'http_error'], [302, 'redirect_error']].map(([status, code]) => [code, async (_url, options) => { expect(options.redirect).toBe('manual'); return { status, ok: false, text: () => { throw Error('Must not read body'); } }; }]),
  ['unexpected_content_type_csv_text_html', async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }), text: () => { throw Error('Must not read body'); } })],
  ['encoding_error', async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/csv; charset=big5' }) })],
  ['encoding_error', fakeFetch('\uFFFD')],
  ['response_too_large', fakeFetch('a'.repeat(2000001))],
  ['csv_format_error', fakeFetch('unexpected header')],
  ['csv_html_mismatch', fakeFetch(exchangeCsv().replace('32.00000', '31.00000'))],
  ['quote_time_error', fakeFetch(exchangeCsv(), exchangeHtml().replace('牌價最新掛牌時間', 'unknown'))],
  ['parse_error', fakeFetch(exchangeCsv().replace('32.00000', 'not-a-number'))],
  ['date_regression', fakeFetch(exchangeCsv(), exchangeHtml().replace('2026/10/20', '2026/10/19'))],
];
it.each(failureCases)('classifies %s without leaking external messages or replacing old bytes', async (code, fetchImpl) => files(async target => {
  const before = JSON.stringify(exchangeFixture()); await writeFile(target, before);
  const error = await updateExchange({ target, fetchImpl, now: () => Date.parse(exchangeCaptured) }).catch(error => error);
  expect(error).toBeInstanceOf(ExchangeUpdateError); expect(error.safeCode).toBe(code); expect(error.message).not.toContain('private-test-value');
  expect(await readFile(target, 'utf8')).toBe(before);
}));
it('preserves target bytes when writing the temporary snapshot fails', async () => files(async target => {
  const before = JSON.stringify(exchangeFixture()), temporary = new URL(target.href + '.tmp'); await writeFile(target, before); await mkdir(temporary);
  try { await expect(updateExchange({ target, fetchImpl: fakeFetch(), now: () => Date.parse(exchangeCaptured) })).rejects.toMatchObject({ safeCode: 'filesystem_error' }); expect(await readFile(target, 'utf8')).toBe(before); }
  finally { await rmdir(temporary); }
}));
it('classifies body-stream timeout and corrupt existing snapshot', async () => files(async target => {
  await writeFile(target, '{broken');
  await expect(updateExchange({ target, fetchImpl: fakeFetch(), now: () => Date.parse(exchangeCaptured) })).rejects.toMatchObject({ safeCode: 'previous_snapshot_invalid' });
  await expect(updateExchange({ target, fetchImpl: async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/csv' }), text: async () => { throw Object.assign(Error('private-test-value'), { name: 'TimeoutError' }); } }) })).rejects.toMatchObject({ safeCode: 'request_timeout' });
  expect(await readFile(target, 'utf8')).toBe('{broken');
}));
it('round-trips only whitelisted numeric exit statuses and rejects arbitrary diagnostics', () => {
  for (const code of EXCHANGE_ERROR_CODES) expect(exchangeCodeFromExitStatus(exchangeExitStatus(new ExchangeUpdateError(code)))).toBe(code);
  for (const status of [1, 0, 255, '64', 'http_403', null]) expect(exchangeCodeFromExitStatus(status)).toBe('update_failed');
  expect(exchangeErrorCode(Object.assign(Error('private-test-value'), { safeCode: 'http_403' }))).toBe('update_failed');
  expect(exchangeExitStatus(new ExchangeUpdateError('http_403'))).toBe(69);
  expect(exchangeExitStatus(new ExchangeUpdateError('unexpected_content_type'))).toBe(74);
  expect(exchangeExitStatus(new ExchangeUpdateError('update_failed'))).toBe(84);
});
it('classifies only fixed MIME names without exposing header parameters or arbitrary text', () => {
  for (const mime of EXCHANGE_MIME_CLASSES.slice(0, 5)) expect(classifyExchangeMime(` ${mime.toUpperCase()}; charset=utf-8; private-test-value`)).toBe(mime);
  for (const value of [null, undefined, '', '   ']) expect(classifyExchangeMime(value)).toBe('missing');
  for (const value of ['application/private-test-value', 'private-test-value\n::error::untrusted']) expect(classifyExchangeMime(value)).toBe('other');
  expect(exchangeMimeFailureCode('untrusted-endpoint', 'private-test-value')).toBe('unexpected_content_type');
});
it.each(['csv', 'html'])('preserves old bytes and passes %s endpoint/MIME diagnostics through numeric statuses', async endpoint => files(async target => {
  const before = JSON.stringify(exchangeFixture()); await writeFile(target, before);
  for (const mime of EXCHANGE_MIME_CLASSES) {
    const expected = endpoint === 'csv' ? 'text/csv' : 'text/html'; if (mime === expected) continue;
    const raw = mime === 'missing' ? null : mime === 'other' ? 'application/private-test-value; note=untrusted' : `${mime}; note=private-test-value`;
    const readBody = vi.fn(() => { throw Error('Mismatched body must not be read'); });
    const fetchImpl = vi.fn(async url => {
      if (endpoint === 'html' && url.includes('flcsv')) return fakeFetch()(url);
      return { ok: true, status: 200, headers: { get: () => raw }, text: readBody };
    });
    const error = await updateExchange({ target, fetchImpl, now: () => Date.parse(exchangeCaptured) }).catch(error => error);
    const code = exchangeMimeFailureCode(endpoint, raw);
    expect(error).toBeInstanceOf(ExchangeUpdateError); expect(error.safeCode).toBe(code);
    expect(exchangeCodeFromExitStatus(exchangeExitStatus(error))).toBe(code);
    expect(error.message).not.toMatch(/private-test-value|untrusted|::error::/);
    expect(readBody).not.toHaveBeenCalled(); expect(fetchImpl).toHaveBeenCalledTimes(endpoint === 'csv' ? 1 : 2);
    expect(await readFile(target, 'utf8')).toBe(before);
  }
}));
it('does not forward untrusted HTML/CSS parser diagnostics to the process console', async () => files(async target => {
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const html = exchangeHtml() + '<style>body { /* private-test-value\n::error::untrusted</style><script>console.error("private-test-value")</script>';
    await updateExchange({ target, fetchImpl: fakeFetch(exchangeCsv(), html), now: () => Date.parse(exchangeCaptured) });
    expect(errorLog).not.toHaveBeenCalled();
  } finally { errorLog.mockRestore(); }
}));
it('CLI reports only a fixed code even when an arbitrary exception contains an Actions command', async () => {
  const previousExit = process.exitCode, errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('Network is forbidden in this test'));
  vi.resetModules();
  vi.doMock('../scripts/lib/exchange-import.mjs', () => ({ updateExchange: async () => { throw Error('private-test-value\n::error::untrusted'); } }));
  try {
    await import('../scripts/update-exchange.mjs');
    expect(errorLog.mock.calls).toEqual([['Exchange update failed: update_failed. Previous snapshot preserved.']]);
    expect(process.exitCode).toBe(exchangeExitStatus(new ExchangeUpdateError('update_failed')));
    expect(network).not.toHaveBeenCalled();
  } finally { process.exitCode = previousExit; errorLog.mockRestore(); network.mockRestore(); vi.doUnmock('../scripts/lib/exchange-import.mjs'); }
});

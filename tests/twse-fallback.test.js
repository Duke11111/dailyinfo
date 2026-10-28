import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fetchLatestQuotes, parseMarketDays, parseMiIndex } from '../scripts/lib/twse-quotes.mjs';
import { QUOTE_SOURCE, QUOTE_FALLBACK_SOURCE, QUOTE_MARKET_SOURCE, quoteReportUrl, parseQuoteRows, validateQuoteSnapshot, quoteSourceDetails } from '../src/services/quotes.js';
import { updateData, contentDigest } from '../scripts/lib/data-automation.mjs';
import { exportState, restoreState } from '../scripts/lib/update-state.mjs';
import { isoInstant } from '../src/lib/time.js';
import { primaryFixture, marketFixture, miFixture } from './fixtures/twse-quotes.js';
import { checkpointFixture } from './fixtures/checkpoint.js';

let clock;
beforeEach(() => { clock = Date.parse('2026-10-28T18:17:00+08:00'); vi.spyOn(Date, 'now').mockImplementation(() => clock); });
afterEach(() => vi.restoreAllMocks());
const reply = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
function transport({ primary = '2026-10-22', days = ['2026-10-22', '2026-10-27'], miDays = days, fallback, modify, fail } = {}) {
  return vi.fn(async (url, options) => {
    expect(options).toMatchObject({ redirect: 'error', cache: 'no-store' }); expect(options.signal).toBeInstanceOf(AbortSignal);
    if (fail?.(url)) throw Error('private response credentials');
    const query = new URL(url), rawDay = query.searchParams.get('date'), requested = rawDay && `${rawDay.slice(0, 4)}-${rawDay.slice(4, 6)}-${rawDay.slice(6)}`;
    let data = url === QUOTE_SOURCE ? primaryFixture(primary)
      : query.pathname.endsWith('/FMTQIK') ? marketFixture(requested, days)
      : fallback === undefined && !miDays.includes(requested) ? { stat: '很抱歉，沒有符合條件的資料!' } : miFixture(fallback ?? requested);
    if (modify) data = modify(data, url) ?? data;
    return reply(data);
  });
}
const load = (fetchImpl, previous = null) => fetchLatestQuotes({ fetchImpl, previous, now: () => clock });
it('runner stale primary 10/22 falls back to official 10/27 and retains accurate provenance', async () => {
  const fetchImpl = transport(); const result = await load(fetchImpl);
  expect(result).toMatchObject({ source: QUOTE_FALLBACK_SOURCE, tradeDate: '2026-10-27', fetchedAt: isoInstant(clock), evidence: {
    method: 'twse-mi-index', latestPublishedTradeDate: '2026-10-27', eligibleTradeDate: '2026-10-27' } });
  expect(result.quotes).toHaveLength(1000); expect(result.quotes.find(q => q.code === '2330').date).toBe('2026-10-27');
  expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([QUOTE_SOURCE, quoteReportUrl(QUOTE_MARKET_SOURCE, '2026-10-28'),
    quoteReportUrl(QUOTE_FALLBACK_SOURCE, '2026-10-28'), quoteReportUrl(QUOTE_FALLBACK_SOURCE, '2026-10-27')]);
  expect(validateQuoteSnapshot(result)).toEqual(result);
  expect(quoteSourceDetails(result)).toEqual({ label: 'TWSE MI_INDEX（日期專屬盤後行情）', url: quoteReportUrl(QUOTE_FALLBACK_SOURCE, '2026-10-27') });
});
it('recovered primary 10/28 normally wins over 10/27 without an unnecessary fallback request', async () => {
  const previous = await load(transport());
  const fetchImpl = transport({ primary: '2026-10-28', days: ['2026-10-27', '2026-10-28'] });
  const result = await load(fetchImpl, previous);
  expect(result.tradeDate).toBe('2026-10-28'); expect(result.source).toBe(QUOTE_SOURCE); expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it('keeps a recovered newer primary when date-specific MI_INDEX independently proves it despite a stale FMTQIK', async () => {
  const fetchImpl = transport({ primary: '2026-10-28', days: ['2026-10-22'], miDays: ['2026-10-28'] });
  const result = await load(fetchImpl);
  expect(result).toMatchObject({ source: QUOTE_SOURCE, tradeDate: '2026-10-28', evidence: { dateProof: { tradeDate: '2026-10-28' } } });
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});
it('adopts a complete official MI_INDEX 10/28 after 17:17 even while FMTQIK still ends at 10/27', async () => {
  const fetchImpl = transport({ miDays: ['2026-10-27', '2026-10-28'] });
  const result = await load(fetchImpl);
  expect(result).toMatchObject({ source: QUOTE_FALLBACK_SOURCE, tradeDate: '2026-10-28', evidence: {
    latestPublishedTradeDate: '2026-10-28', eligibleTradeDate: '2026-10-28', dateProof: {
      tradeDate: '2026-10-28', url: quoteReportUrl(QUOTE_FALLBACK_SOURCE, '2026-10-28') } } });
  expect(result.quotes).toHaveLength(1000); expect(validateQuoteSnapshot(result)).toEqual(result);
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});
it.each(['url', 'digest', 'date'])('rejects a forged independent publication proof: %s', async field => {
  const data = await load(transport({ miDays: ['2026-10-28'] }));
  if (field === 'url') data.evidence.dateProof.url = 'https://example.invalid/fake';
  if (field === 'digest') data.evidence.dateProof.sha256 = '0'.repeat(64);
  if (field === 'date') data.evidence.dateProof.tradeDate = '2026-10-27';
  expect(() => validateQuoteSnapshot(data)).toThrow();
});
it.each(['empty', 'incomplete', 'wrong-date'])('does not claim 10/28 published from an %s MI_INDEX response', async fault => {
  const fetchImpl = transport({ miDays: ['2026-10-27', '2026-10-28'], modify(data, url) {
    if (!url.includes('/MI_INDEX') || !url.endsWith('20261028')) return;
    if (fault === 'empty') data.tables[0].data = [];
    if (fault === 'incomplete') data.tables[0].fields.pop();
    if (fault === 'wrong-date') data.date = '20261027';
  } });
  await expect(load(fetchImpl)).rejects.toThrow(); expect(fetchImpl).toHaveBeenCalledTimes(3);
});
it('an official no-data response for 10/28 keeps the verified historical day without inventing today', async () => {
  const result = await load(transport()); expect(result.tradeDate).toBe('2026-10-27'); expect(result.evidence.dateProof).toBeUndefined();
});
it('never probes/adopts 10/28 before 17:17 even when MI_INDEX has already published it', async () => {
  clock = Date.parse('2026-10-28T16:59:00+08:00');
  const fetchImpl = transport({ miDays: ['2026-10-27', '2026-10-28'] });
  expect((await load(fetchImpl)).tradeDate).toBe('2026-10-27');
  expect(fetchImpl.mock.calls.some(([url]) => url.includes('/MI_INDEX') && url.endsWith('20261028'))).toBe(false);
});
it('bounds publication probes to seven calendar days, never retries a date or labels an unproven old date as latest', async () => {
  const fetchImpl = transport({ primary: '2026-10-01', days: ['2026-10-01'], miDays: [] });
  await expect(load(fetchImpl)).rejects.toThrow('twse_publication_unverified');
  const urls = fetchImpl.mock.calls.map(([url]) => url);
  expect(urls).toHaveLength(7); expect(new Set(urls).size).toBe(urls.length);
});
it('a new-month MI_INDEX report can prove publication independently of the previous-month calendar', async () => {
  clock = Date.parse('2026-11-02T18:17:00+08:00');
  const fetchImpl = transport({ days: ['2026-10-30'], miDays: ['2026-11-02'], modify(data, url) {
    if (url.includes('/FMTQIK') && url.endsWith('20261102')) return { stat: '很抱歉，沒有符合條件的資料!' };
  } });
  const result = await load(fetchImpl);
  expect(result.tradeDate).toBe('2026-11-02'); expect(result.evidence.marketDate).toBe('2026-10-31');
  expect(validateQuoteSnapshot(result).evidence.dateProof.tradeDate).toBe('2026-11-02'); expect(fetchImpl).toHaveBeenCalledTimes(4);
});
it('before 17:17 uses 10/27 even if the primary and official market already contain 10/28; after 17:17 admits 10/28', async () => {
  clock = Date.parse('2026-10-28T16:59:00+08:00');
  let result = await load(transport({ primary: '2026-10-28', days: ['2026-10-27', '2026-10-28'] }));
  expect(result.tradeDate).toBe('2026-10-27'); expect(result.evidence.latestPublishedTradeDate).toBe('2026-10-28');
  clock = Date.parse('2026-10-28T17:17:00+08:00');
  result = await load(transport({ days: ['2026-10-27', '2026-10-28'] }), result);
  expect(result.tradeDate).toBe('2026-10-28');
});
it.each(['2026-10-22', '2026-10-28'])('rejects a CDN fallback for the wrong date %s', async fallback => {
  clock = Date.parse('2026-10-28T16:59:00+08:00');
  await expect(load(transport({ fallback }))).rejects.toThrow('twse_validation_failed');
});
it('never lets a stale primary/fallback replace a later saved trading date or same-date later capture', async () => {
  const previous = parseQuoteRows(primaryFixture('2026-10-28'), isoInstant(clock - 60000));
  await expect(load(transport(), previous)).rejects.toThrow('twse_regression_refused');
  const later = parseQuoteRows(primaryFixture('2026-10-27'), isoInstant(clock + 1000));
  await expect(load(transport(), later)).rejects.toThrow('twse_regression_refused');
  const earlier = parseQuoteRows(primaryFixture('2026-10-27'), isoInstant(clock - 1000));
  expect((await load(transport(), earlier)).fetchedAt).toBe(isoInstant(clock));
});
it.each(['title', 'date', 'fields', 'duplicate', 'weekend', 'future', 'numbers'])('rejects invalid official market evidence: %s', async fault => {
  await expect(load(transport({ modify(data, url) {
    if (!url.includes('/FMTQIK')) return;
    if (fault === 'title') data.title = 'Protection page';
    if (fault === 'date') data.date = '20261022';
    if (fault === 'fields') data.fields.reverse();
    if (fault === 'duplicate') data.data.push(data.data[0]);
    if (fault === 'weekend') data.data[0][0] = '115/10/25';
    if (fault === 'future') data.data.at(-1)[0] = '115/10/29';
    if (fault === 'numbers') data.data[0][1] = '-1';
  } }))).rejects.toThrow();
});
it.each(['fields', 'sign', 'date', 'duplicate', 'truncated', 'missing', 'range'])('rejects malformed date-specific whole-market report: %s', async fault => {
  await expect(load(transport({ modify(data, url) {
    if (!url.includes('/MI_INDEX')) return;
    const table = data.tables[0];
    if (fault === 'fields') [table.fields[2], table.fields[3]] = [table.fields[3], table.fields[2]];
    if (fault === 'sign') table.data[0][9] = '<script>private</script>';
    if (fault === 'date') table.title = table.title.replace('27日', '22日');
    if (fault === 'duplicate') table.data[1][0] = table.data[0][0];
    if (fault === 'truncated') table.data.length = 1;
    if (fault === 'missing') table.data[0].pop();
    if (fault === 'range') table.data[0][6] = '1.00';
  } }))).rejects.toThrow();
});
it('keeps missing prices, zero trades and official special-change markers without fabricating zeros or stripping HTML', () => {
  const data = miFixture('2026-10-27'); const row = data.tables[0].data[0];
  [row[5], row[6], row[7], row[8]] = ['--', '--', '--', '--']; row[2] = '0'; row[9] = '<p>X</p>'; row[10] = '0.00';
  const result = parseMiIndex(data, '2026-10-27', isoInstant(clock));
  expect(result.quotes[0]).toMatchObject({ close: null, change: null, percent: null, volume: 0 });
});
it.each(['market', 'fallback'])('fails closed when official %s is unavailable, with bounded requests and no retries', async unavailable => {
  const fetchImpl = transport({ fail: url => url.includes(unavailable === 'market' ? '/FMTQIK' : '/MI_INDEX') });
  await expect(load(fetchImpl)).rejects.toThrow(/twse_(market_unverified|request_failed)/);
  expect(fetchImpl).toHaveBeenCalledTimes(unavailable === 'market' ? 2 : 3);
});
it('can use a verified official fallback if primary HTTP/schema fails, without accepting primary partial content', async () => {
  expect((await load(transport({ fail: url => url === QUOTE_SOURCE }))).tradeDate).toBe('2026-10-27');
  expect((await load(transport({ modify: (data, url) => url === QUOTE_SOURCE ? data.slice(0, 3) : data }))).source).toBe(QUOTE_FALLBACK_SOURCE);
});
it.each(['http', 'mime', 'json'])('refuses invalid market transport %s without a fallback request', async fault => {
  const original = transport(); const fetchImpl = vi.fn((url, options) => url.includes('/FMTQIK')
    ? Promise.resolve(new Response(fault === 'json' ? '{broken' : '{}', { status: fault === 'http' ? 503 : 200,
      headers: { 'Content-Type': fault === 'mime' ? 'text/html' : 'application/json' } })) : original(url, options));
  await expect(load(fetchImpl)).rejects.toThrow('twse_market_unverified'); expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it('aborts a hanging market request within the configured timeout, with no retry', async () => {
  vi.useFakeTimers();
  try {
    const original = transport(); const fetchImpl = vi.fn((url, options) => url.includes('/FMTQIK')
      ? new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('private timeout')))) : original(url, options));
    const pending = expect(fetchLatestQuotes({ fetchImpl, now: () => clock, timeout: 8000 })).rejects.toThrow('twse_market_unverified');
    await vi.advanceTimersByTimeAsync(8000); await pending; expect(fetchImpl).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
it('the month boundary consults the previous month at most once, based on actual published rows', async () => {
  clock = Date.parse('2026-11-01T18:17:00+08:00');
  const fetchImpl = transport({ primary: '2026-10-22', days: ['2026-10-30'], modify(data, url) {
    if (url.includes('/FMTQIK') && url.endsWith('20261101')) return { stat: '很抱歉，沒有符合條件的資料!' };
  } });
  const result = await load(fetchImpl); expect(result.tradeDate).toBe('2026-10-30'); expect(fetchImpl).toHaveBeenCalledTimes(4);
});
it.each(['2026-10-24', '2026-10-26'])('weekend/official holiday %s is not source_delayed when latest published date is 10/22', async day => {
  clock = Date.parse(day + 'T18:17:00+08:00');
  const data = await load(transport({ days: ['2026-10-22'] }));
  const base = resolve('.cache/test-results/twse-holiday'); await mkdir(base, { recursive: true }); const root = await mkdtemp(join(base, 'case-'));
  try {
    await mkdir(join(root, 'public/data'), { recursive: true });
    await writeFile(join(root, 'public/data/quotes.json'), JSON.stringify(parseQuoteRows(primaryFixture('2026-10-22'), isoInstant(clock - 60000))));
    const report = await updateData({ root, sources: ['quotes'], now: () => clock, runner: async (_, { directory }) => writeFile(join(directory, 'quotes.json'), JSON.stringify(data)) });
    expect(report.results[0].code).toBe('ok'); expect(report.failed).toBe(0);
  } finally { if (!resolve(root).startsWith(base + sep)) throw Error('unsafe_cleanup'); await rm(root, { recursive: true }); }
});
it('fallback acquisition is independently validated through automation and checkpoint v2, preserving old data on a rejected response', async () => {
  const base = resolve('.cache/test-results/twse-update'); await mkdir(base, { recursive: true }); const root = await mkdtemp(join(base, 'case-'));
  try {
    await mkdir(join(root, 'public/data'), { recursive: true });
    for (const source of ['quotes', 'news', 'earthquakes', 'horoscope']) await writeFile(join(root, 'public/data', source + '.json'), JSON.stringify(source === 'quotes' ? parseQuoteRows(primaryFixture('2026-10-22'), '2026-10-22T10:00:00Z') : checkpointFixture(source)));
    const run = async io => updateData({ root, sources: ['quotes'], now: () => clock, runner: async (_, { directory }) => {
      const previous = JSON.parse(await readFile(join(directory, 'quotes.json')));
      const data = await load(io, previous); await writeFile(join(directory, 'quotes.json'), JSON.stringify(data));
    } });
    const first = await run(transport()); expect(first.results[0]).toMatchObject({ status: 'updated', code: 'ok', sourceDate: '2026-10-27' });
    const path = join(root, 'public/data/quotes.json'), accepted = await readFile(path, 'utf8');
    const checkpoint = join(root, 'checkpoint'); await exportState(root, checkpoint, 'a'.repeat(40));
    expect(JSON.parse(await readFile(join(checkpoint, 'manifest.json'))).version).toBe(2);
    await restoreState(root, checkpoint, clock, { expectedCommit: 'a'.repeat(40) });
    expect(validateQuoteSnapshot(JSON.parse(await readFile(path))).evidence.method).toBe('twse-mi-index');
    expect((await run(transport({ fallback: '2026-10-22' }))).changed).toBe(false);
    // Restore normalizes JSON whitespace but not financial values/time/provenance.
    expect(contentDigest(JSON.parse(await readFile(path)))).toBe(contentDigest(JSON.parse(accepted)));
  } finally { if (!resolve(root).startsWith(base + sep)) throw Error('unsafe_cleanup'); await rm(root, { recursive: true }); }
});
it('legacy primary snapshots remain compatible; forged fallback provenance is rejected', async () => {
  const legacy = parseQuoteRows(primaryFixture('2026-10-22'), isoInstant(clock)); expect(validateQuoteSnapshot(legacy).source).toBe(QUOTE_SOURCE);
  const data = await load(transport());
  for (const bad of [{ ...data, evidence: undefined }, { ...data, evidence: { ...data.evidence, dataUrl: 'https://example.invalid/' } },
    { ...data, evidence: { ...data.evidence, eligibleTradeDate: '2026-10-22' } },
    { ...data, evidence: { ...data.evidence, checkedAt: '2026-10-29T10:00:00Z' } }]) expect(() => validateQuoteSnapshot(bad)).toThrow();
});

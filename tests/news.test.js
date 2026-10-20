import { it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { newsUrl, newsTime, validateArticle, validateNewsSnapshot, filterNews, fetchNewsSnapshot, createNewsStore, isNewsStale } from '../src/services/news.js';
import { article, secondArticle, newsFixture, fetchedAt, rss } from './fixtures/news.js';
import { parseNewsRss, mergeNewsArticles } from '../scripts/lib/news-rss.mjs';
afterEach(() => vi.useRealTimers());
it('parses official RSS fields, decodes entities, strips HTML and preserves the CNA dateline', () => {
  const item = parseNewsRss(rss(), 'technology', fetchedAt)[0];
  expect(item.title).toBe('台灣科技 & 測試'); expect(item.summary).toBe('（中央社測試訊頭）前言'); expect(item.publishedAt).toBe('2026-10-19T12:00:00.000Z');
});
it.each(['<!DOCTYPE rss><rss/>', '<!ENTITY x "oops">', '<rss version="2.0"><channel>', '<html>not RSS</html>', rss().replace('中央社測試新聞', 'other'), rss().replace('version="2.0"', 'version="1.0"')])('rejects invalid or unsafe RSS', value => { expect(() => parseNewsRss(value, 'technology', fetchedAt)).toThrow(); });
it.each(['Mon, 30 Feb 2026 20:00:00 +0800', 'Mon, 19 Oct 2026 25:00:00 +0800', 'not a date'])('rejects invalid publication date %s', date => { expect(() => parseNewsRss(rss().replace('Mon, 19 Oct 2026 20:00:00 +0800', date), 'technology', fetchedAt)).toThrow(); });
it('rejects duplicate/missing fields and unknown categories', () => {
  expect(() => parseNewsRss(rss().replace('</title><link>', '</title><title>Duplicate</title><link>'), 'technology', fetchedAt)).toThrow();
  expect(() => parseNewsRss(rss().replace(/<pubDate>.*?<\/pubDate>/, ''), 'technology', fetchedAt)).toThrow();
  expect(() => parseNewsRss(rss(), 'unknown', fetchedAt)).toThrow();
});
it('deduplicates news by canonical URL while retaining all categories', () => {
  const merged = mergeNewsArticles([[article()], [article({ categories: ['finance'] }), secondArticle()]]);
  expect(merged).toHaveLength(2); expect(merged[0].categories).toEqual(['technology', 'finance']);
});
it.each(['javascript:alert(1)', 'http://www.cna.com.tw/news/ait/202610190001.aspx', 'https://www.cna.com.tw.evil.test/news/ait/202610190001.aspx', 'https://user:pass@www.cna.com.tw/news/ait/202610190001.aspx', 'https://www.cna.com.tw/news/ait/202610190001.aspx?next=https://evil.test', 'https://www.cna.com.tw/about/rss.aspx'])('rejects unsafe or non-article links %s', url => { expect(() => newsUrl(url)).toThrow(); });
it('validates snapshot provenance, identity, dates and category metadata', () => {
  expect(validateNewsSnapshot(newsFixture()).articles).toHaveLength(2);
  expect(() => newsTime('2026-02-30T00:00:00.000Z')).toThrow();
  expect(() => validateArticle(article({ id: 'wrong' }))).toThrow();
  expect(() => validateArticle(article({ publishedAt: '2026-10-20T12:00:00.000Z' }))).toThrow();
  expect(() => validateNewsSnapshot({ ...newsFixture(), articles: [article(), article()] })).toThrow();
  expect(() => validateNewsSnapshot({ ...newsFixture(), feeds: [] })).toThrow();
  const corrupt = newsFixture(); corrupt.feeds[0].url = 'https://evil.test/rss'; expect(() => validateNewsSnapshot(corrupt)).toThrow();
});
it('searches title and summary keywords with 台／臺 normalization and filters/sorts', () => {
  const data = [article(), secondArticle()];
  expect(filterNews(data, { query: '臺灣 科技' }).map(a => a.title)).toEqual([article().title]);
  expect(filterNews(data, { query: 'RSS 前言', category: 'finance' })).toHaveLength(1);
  expect(filterNews(data, { query: '不存在' })).toEqual([]);
  expect(filterNews(data, { category: 'social' })).toEqual([]);
  expect(filterNews(data, { order: 'oldest' })[0].id).toBe(secondArticle().id); expect(data[0].id).toBe(article().id);
});
it('identifies stale snapshots and accepts a valid empty snapshot', () => {
  expect(isNewsStale(newsFixture(), Date.parse(fetchedAt) + 86400001)).toBe(true);
  expect(isNewsStale(newsFixture(), Date.parse(fetchedAt))).toBe(false);
  expect(validateNewsSnapshot({ ...newsFixture(), articles: [] }).articles).toEqual([]);
});
it('validates the actual imported snapshot and all five feeds', () => {
  const snapshot = validateNewsSnapshot(JSON.parse(readFileSync(new URL('../public/data/news.json', import.meta.url), 'utf8')));
  expect(snapshot.articles.length).toBeGreaterThan(20); expect(snapshot.feeds.map(f => f.category)).toHaveLength(5);
  expect(snapshot.articles.every(a => a.url.startsWith('https://www.cna.com.tw/news/') && !a.summary.includes('<img'))).toBe(true);
});
it('reads the same-origin production snapshot', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => newsFixture() }));
  expect((await fetchNewsSnapshot({ fetchImpl: fetcher })).articles).toHaveLength(2); expect(fetcher.mock.calls[0][0]).toBe(`${import.meta.env.BASE_URL}data/news.json`);
});
it.each(['HTTP', 'JSON', 'offline', 'invalid'])('reports %s snapshot errors', async mode => {
  const fetchImpl = async () => {
    if (mode === 'offline') throw Error('offline');
    return { ok: mode !== 'HTTP', status: 503, json: async () => { if (mode === 'JSON') throw Error('invalid JSON'); return {}; } };
  };
  await expect(fetchNewsSnapshot({ fetchImpl })).rejects.toThrow();
});
it('aborts timed out snapshot requests', async () => {
  vi.useFakeTimers();
  const request = fetchNewsSnapshot({ timeout: 100, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error(), { name: 'AbortError' })))) });
  const result = expect(request).rejects.toThrow('逾時'); await vi.advanceTimersByTimeAsync(101); await result;
});
it('coalesces requests, caches reads, respects cooldown and forces a later refresh', async () => {
  let clock = 100000; const fetcher = vi.fn(async () => newsFixture()), store = createNewsStore({ fetcher, now: () => clock });
  await Promise.all([store.load(), store.load()]); expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await store.load({ force: true })).cached).toBe(true); clock += 10001; await store.load({ force: true }); expect(fetcher).toHaveBeenCalledTimes(2);
  clock += 300001; await store.load(); expect(fetcher).toHaveBeenCalledTimes(3);
});
it('preserves last news on failure and rejects older snapshots', async () => {
  let clock = 100000; const fetcher = vi.fn().mockResolvedValueOnce(newsFixture()).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({ ...newsFixture(), fetchedAt: '2026-10-18T13:00:00.000Z' });
  const store = createNewsStore({ fetcher, now: () => clock }); await store.load(); clock += 10001;
  await expect(store.load({ force: true })).rejects.toThrow('offline'); expect(store.peek().articles).toHaveLength(2); clock += 10001;
  await expect(store.load({ force: true })).rejects.toThrow('較舊'); expect(store.peek().fetchedAt).toBe(fetchedAt);
});

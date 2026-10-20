import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { snapshotTarget } from './lib/snapshot-target.mjs';
import { NEWS_SOURCE, NEWS_RSS_PAGE, NEWS_CATEGORIES, feedUrl, validateNewsSnapshot } from '../src/services/news.js';
import { parseNewsRss, mergeNewsArticles } from './lib/news-rss.mjs';

const target = snapshotTarget('news');
try {
  const batches = [], feeds = [];
  // Only the five allowlisted RSS endpoints, once each; no full articles or images.
  for (const category of Object.keys(NEWS_CATEGORIES)) {
    const url = feedUrl(category);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`${category} HTTP ${response.status}`);
    if (!/\b(?:text|application)\/(?:rss\+xml|xml)\b/i.test(response.headers.get('content-type') ?? '')) throw new Error(`${category} 並非 XML`);
    const xml = await response.text(), fetchedAt = new Date().toISOString();
    const articles = parseNewsRss(xml, category, fetchedAt);
    if (!articles.length) throw new Error(`${category} 沒有新聞，保留舊快照`);
    batches.push(articles); feeds.push({ category, url, fetchedAt, count: articles.length, sha256: createHash('sha256').update(xml).digest('hex') });
  }
  const snapshot = validateNewsSnapshot({ version: 1, source: NEWS_SOURCE, sourceUrl: NEWS_RSS_PAGE, fetchedAt: new Date().toISOString(), feeds, articles: mergeNewsArticles(batches) });
  let previous;
  try { previous = validateNewsSnapshot(JSON.parse(await readFile(target, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && previous.fetchedAt > snapshot.fetchedAt) throw new Error('拒絕以較舊快照覆寫');
  // All categories succeed and validate before replacing the existing file.
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n'); await rename(temporary, target);
  console.log(JSON.stringify({ fetchedAt: snapshot.fetchedAt, count: snapshot.articles.length, feeds: feeds.map(({ category, count, fetchedAt }) => ({ category, count, fetchedAt })), newest: snapshot.articles[0]?.publishedAt }, null, 2));
} catch (error) { console.error(`新聞更新失敗，原有快照及收藏未變更：${error.message}`); process.exitCode = 1; }

// @vitest-environment jsdom
import { beforeEach, it, expect, vi } from 'vitest';
import { NEWS_FAVORITES_KEY, loadNewsFavorites, toggleNewsFavorite, validateFavorites } from '../src/services/news-favorites.js';
import { article, secondArticle } from './fixtures/news.js';
beforeEach(() => localStorage.clear());
it('persists, restores and removes favorites without affecting other modules', () => {
  localStorage.setItem('dailyinfo.watchlists.v1', 'preserve');
  const added = toggleNewsFavorite(loadNewsFavorites().data, article());
  expect(loadNewsFavorites().data).toEqual(added);
  const both = toggleNewsFavorite(added, secondArticle()); expect(both.articles).toHaveLength(2);
  const removed = toggleNewsFavorite(both, article()); expect(removed.articles).toEqual([secondArticle()]); expect(localStorage.getItem('dailyinfo.watchlists.v1')).toBe('preserve');
});
it.each(['{broken', '{"version":2,"articles":[]}', '{"version":1,"articles":"wrong"}'])('locks corrupt data without overwriting it', raw => {
  localStorage.setItem(NEWS_FAVORITES_KEY, raw); expect(loadNewsFavorites().locked).toBe(true); expect(localStorage.getItem(NEWS_FAVORITES_KEY)).toBe(raw);
});
it('rejects duplicate favorites and unsafe stored URLs', () => {
  expect(() => validateFavorites({ version: 1, articles: [article(), article()] })).toThrow();
  expect(() => validateFavorites({ version: 1, articles: [article({ url: 'javascript:alert(1)' })] })).toThrow();
});
it.each(['QuotaExceededError', 'SecurityError'])('keeps the previous state after %s', name => {
  const previous = { version: 1, articles: [article()] }, copy = JSON.stringify(previous);
  const storage = { setItem: vi.fn(() => { throw Object.assign(Error(), { name }); }) };
  expect(() => toggleNewsFavorite(previous, secondArticle(), storage)).toThrow('原有收藏保留'); expect(JSON.stringify(previous)).toBe(copy);
});
it('handles denied reads', () => { expect(loadNewsFavorites({ getItem: () => { throw Error('denied'); } }).locked).toBe(true); });

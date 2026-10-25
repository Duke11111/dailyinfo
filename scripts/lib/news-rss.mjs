import { isoInstant } from '../../src/lib/time.js';
import { JSDOM } from 'jsdom';
import { NEWS_SOURCE, validateArticle } from '../../src/services/news.js';

// Existing dev dependency; parsing does not enable scripts or fetch HTML resources.
const Parser = new JSDOM('').window.DOMParser;
function publicationTime(raw) {
  const match = /^[A-Za-z]{3}, (\d{1,2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(raw);
  if (!match) throw new Error('RSS 發布時間異常。');
  const [, day, month, year, hour, minute, second, sign, offsetHour, offsetMinute] = match;
  const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month);
  const clock = new Date(Date.UTC(+year, monthIndex, +day, +hour, +minute, +second));
  if (monthIndex < 0 || clock.getUTCFullYear() !== +year || clock.getUTCMonth() !== monthIndex || clock.getUTCDate() !== +day || +hour > 23 || +minute > 59 || +second > 59 || +offsetHour > 14 || +offsetMinute > 59 || (+offsetHour === 14 && +offsetMinute !== 0)) throw new Error('RSS 發布時間異常。');
  return isoInstant(clock.getTime() - (sign === '+' ? 1 : -1) * (+offsetHour * 60 + +offsetMinute) * 60000);
}
function plain(raw) {
  const document = new Parser().parseFromString(raw, 'text/html');
  document.querySelectorAll('script, style, iframe, object, template').forEach(node => node.remove());
  return document.body.textContent.replace(/\s+/g, ' ').trim();
}
export function parseNewsRss(xml, category, fetchedAt) {
  if (typeof xml !== 'string' || xml.length > 2000000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('RSS 大小或宣告不安全。');
  const document = new Parser().parseFromString(xml, 'text/xml');
  const channel = document.querySelector('rss > channel');
  if (document.querySelector('parsererror') || document.documentElement.tagName !== 'rss' || document.documentElement.getAttribute('version') !== '2.0' || !channel || !channel.querySelector('title')?.textContent.includes('中央社')) throw new Error('不是有效的中央社 RSS 2.0。');
  const field = (item, name) => {
    const children = [...item.children].filter(node => node.tagName === name);
    if (children.length !== 1) throw new Error(`RSS 欄位缺少或重複：${name}`);
    return children[0].textContent.trim();
  };
  return [...channel.children].filter(node => node.tagName === 'item').map(item => {
    const url = field(item, 'link'), date = field(item, 'pubDate');
    return validateArticle({ id: url, url, title: plain(field(item, 'title')), summary: plain(field(item, 'description')), categories: [category], publishedAt: publicationTime(date), fetchedAt, source: NEWS_SOURCE });
  });
}
export function mergeNewsArticles(batches) {
  const map = new Map();
  for (const article of batches.flat()) {
    const previous = map.get(article.id);
    if (!previous) map.set(article.id, article);
    else map.set(article.id, { ...(article.fetchedAt >= previous.fetchedAt ? article : previous), categories: [...new Set([...previous.categories, ...article.categories])] });
  }
  return [...map.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
}

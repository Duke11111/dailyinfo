import { taipeiDate, calendarWeekday, taipeiStartOfDay, olderThan } from '../lib/time.js';
export const CACHE_POLICY = Object.freeze({
  timeout: 8000,
  cooldown: 10000,
  weather: 15 * 60000,
  air: 5 * 60000,
  airRefresh: 30 * 60000,
  news: 5 * 60000,
  earthquakes: 5 * 60000,
  quotes: 5 * 60000, // Poll published quotes, never infer or synthesize a trading day.
  quotesIdle: 30 * 60000,
  catalog: 24 * 3600000,
  history: 30 * 60000,
  horoscope: 5 * 60000,
  snapshotWarning: 24 * 3600000,
  persistentMaxAge: 7 * 86400000,
});
export function quoteCacheTTL(data, now) {
  const today = taipeiDate(now);
  if (!data || data.tradeDate > today || olderThan(data.fetchedAt, CACHE_POLICY.snapshotWarning, now)) return CACHE_POLICY.quotes;
  const weekend = [0, 6].includes(calendarWeekday(today));
  return !weekend && now - taipeiStartOfDay(today) >= 17 * 3600000 && data.tradeDate < today
    ? CACHE_POLICY.quotes : CACHE_POLICY.quotesIdle;
}

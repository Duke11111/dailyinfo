import { compareSnapshotTime } from './time.js';
export function snapshotSourceDate(source, data) {
  if (source === 'quotes') return data.tradeDate;
  if (source === 'news') return data.articles.map(a => a.publishedAt).sort().at(-1);
  if (source === 'earthquakes') return data.events.map(e => e.originTime).sort().at(-1);
  if (source === 'horoscope') return data.readings[0].date;
  return data.fetchedAt;
}
export const compareSnapshots = (source, next, old) => compareSnapshotTime(next, old, data => snapshotSourceDate(source, data));
export function compiledBaseline(name) {
  return typeof __DAILYINFO_BASELINE__ === 'undefined' ? null : __DAILYINFO_BASELINE__[name] ?? null;
}
export function behindBaseline(name, data, baseline) {
  return !!data && !!baseline && compareSnapshotTime(
    { sourceDate: snapshotSourceDate(name, data), fetchedAt: data.fetchedAt }, baseline, item => item.sourceDate) < 0;
}

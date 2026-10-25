// Instants stay explicit ISO-8601 UTC (schema/checksum compatible). Calendar decisions
// and display use Taiwan; never infer the machine/runner's timezone.
export const TIME_ZONE = 'Asia/Taipei';
export const DAY_MS = 86400000;
export const nowMs = () => Date.now();
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const clock = seconds => new Intl.DateTimeFormat('zh-TW', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23' });
const clocks = [clock(false), clock(true)];
export function instantMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  return typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}
export const isoInstant = (value = nowMs()) => new Date(instantMs(value)).toISOString();
export const taipeiDate = (value = nowMs()) => dayFormatter.format(new Date(instantMs(value)));
export const formatTaipeiDateLabel = (value = nowMs(), options = {}) => new Intl.DateTimeFormat('zh-TW', { ...options, timeZone: TIME_ZONE }).format(new Date(instantMs(value)));
export function shiftCalendarMonth(month, count) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Invalid month');
  const date = new Date(taipeiStartOfDay(month + '-01') + 12 * 3600000);
  date.setUTCMonth(date.getUTCMonth() + count); return taipeiDate(date).slice(0, 7);
}
export function validDateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && isoInstant(Date.parse(value)).slice(0, 10) === value;
}
export function taipeiStartOfDay(day) { if (!validDateOnly(day)) throw Error('Invalid calendar date'); return Date.parse(day + 'T00:00:00+08:00'); }
export function addCalendarDays(day, count) { return taipeiDate(taipeiStartOfDay(day) + count * DAY_MS); }
export function calendarWeekday(day) { return new Date(taipeiStartOfDay(day) + 12 * 3600000).getUTCDay(); }
export function formatTaipei(value, { seconds = false } = {}) {
  const stamp = instantMs(value); return Number.isFinite(stamp) ? clocks[Number(seconds)].format(new Date(stamp)).replace(/\s+/g, ' ') : '未提供';
}
export function elapsedMs(value, now = nowMs()) { return now - instantMs(value); }
export const olderThan = (value, duration, now = nowMs()) => elapsedMs(value, now) > duration;
export function compareSnapshotTime(next, old, sourceDay = value => value.fetchedAt) {
  if (!old) return 1;
  const key = value => { const day = sourceDay(value); return validDateOnly(day) ? Date.parse(day + 'T00:00:00Z') : instantMs(day); };
  const a = key(next), b = key(old), fetchedA = instantMs(next.fetchedAt), fetchedB = instantMs(old.fetchedAt);
  if (![a, b, fetchedA, fetchedB].every(Number.isFinite)) throw Error('資料時間無效。');
  return Math.sign(a - b) || Math.sign(fetchedA - fetchedB);
}
export function assertNoTimeRegression(next, old, sourceDay = value => value.fetchedAt) {
  if (!old) return;
  if (compareSnapshotTime(next, old, sourceDay) < 0) throw Error('網站回傳較舊快照，已保留原本較新的資料。');
}
export function optionalUpdatedAt(data) {
  if (data.updatedAt === undefined) return {};
  if (!Number.isFinite(instantMs(data.updatedAt)) || instantMs(data.updatedAt) < instantMs(data.fetchedAt) || instantMs(data.updatedAt) > nowMs() + 300000) throw Error('本站更新時間無效。');
  return { updatedAt: data.updatedAt };
}

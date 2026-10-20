export const formatNumber = (value) => Number.isFinite(value) ? Math.round(value).toString() : '—';
export function formatTime(value) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
export function dayLabel(value, index) {
  return index === 0 ? '今天' : new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'short' }).format(new Date(`${value}T12:00:00+08:00`));
}

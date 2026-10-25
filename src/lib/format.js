import { nowMs } from './time.js';
import { formatTaipei, taipeiDate, formatTaipeiDateLabel } from './time.js';
export const formatNumber = (value) => Number.isFinite(value) ? Math.round(value).toString() : '—';
export function formatTime(value) {
  return formatTaipei(value);
}
export function dayLabel(value, index, now = nowMs()) {
  const today = taipeiDate(now);
  return value === today ? '今天' : formatTaipeiDateLabel(`${value}T12:00:00+08:00`, { weekday: 'short' });
}

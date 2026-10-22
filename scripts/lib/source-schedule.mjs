export const SCHEDULES = Object.freeze([
  { name: 'morning', cron: '37 2 * * *', minute: 10 * 60 + 37 },
  { name: 'evening', cron: '43 12 * * *', minute: 20 * 60 + 43 },
  { name: 'recovery', cron: '47 14 * * *', minute: 22 * 60 + 47 },
]);
export const RETRY_COOLDOWN = 60 * 60000;
const dayOf = time => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
const startOf = day => Date.parse(day + 'T00:00:00+08:00');
const stamp = time => new Date(time).toISOString();
const weekday = day => ![0, 6].includes(new Date(day + 'T12:00:00Z').getUTCDay());
function nextDay(time, source) {
  let day = dayOf(time + 86400000);
  while (source === 'quotes' && !weekday(day)) day = dayOf(startOf(day) + 86400000);
  return startOf(day) + SCHEDULES[source === 'quotes' ? 1 : 0].minute * 60000;
}
function nextWindow(time, source) {
  const start = startOf(dayOf(time));
  const next = SCHEDULES.find(slot => (source !== 'quotes' || slot.name !== 'morning') && start + slot.minute * 60000 > time);
  return next ? start + next.minute * 60000 : nextDay(time, source);
}

// One attempt per named window, even after failures. No timers or automatic retries.
// Explicit cron keeps a delayed morning invocation from masquerading as the evening one.
export function scheduleDecision(source, state, now = Date.now(), { cron } = {}) {
  if (!['quotes', 'news', 'earthquakes', 'horoscope'].includes(source) || !Number.isFinite(now)) throw Error('schedule_invalid');
  if (cron !== undefined && !SCHEDULES.some(slot => slot.cron === cron)) throw Error('schedule_cron_invalid');
  const day = dayOf(now), start = startOf(day), minute = (now - start) / 60000;
  const slot = cron === undefined ? SCHEDULES.filter(item => item.minute <= minute).at(-1) : SCHEDULES.find(item => item.cron === cron);
  const later = () => {
    if (!slot || minute < slot.minute) return start + (slot?.minute ?? SCHEDULES[0].minute) * 60000;
    return nextWindow(now, source);
  };
  const result = (due, reason, next) => ({ due, reason, slot: slot?.name ?? 'none', nextEligibleAt: stamp(next ?? later()) });
  if (source === 'quotes' && !weekday(day)) return result(false, 'weekend', nextDay(now, source));
  if (!slot || minute < slot.minute) return result(false, 'before_window', !slot && source === 'quotes' ? start + SCHEDULES[1].minute * 60000 : undefined);
  if (source === 'quotes' && (slot.name === 'morning' || minute < 17 * 60)) return result(false, 'before_market_close', nextWindow(now, source));
  const item = state.sources[source], attempt = Date.parse(item?.attemptedAt), success = Date.parse(item?.lastSuccessAt);
  const daily = ['quotes', 'horoscope'].includes(source);
  const successFloor = start + (source === 'quotes' ? 17 * 60 : source === 'horoscope' ? 9 * 60 : slot.name === 'morning' ? SCHEDULES[0].minute : SCHEDULES[1].minute) * 60000;
  if (success >= successFloor && success <= now && item?.code !== 'source_delayed') {
    return result(false, 'already_successful', daily || success >= start + SCHEDULES[1].minute * 60000 ? nextDay(now, source) : nextWindow(now, source));
  }
  // Old status v1 needs no migration: attemptedAt itself records the last occupied window.
  if (attempt >= start + slot.minute * 60000) return result(false, 'window_already_attempted');
  if (Number.isFinite(attempt) && now - attempt < RETRY_COOLDOWN) return result(false, 'cooldown', Math.max(later(), attempt + RETRY_COOLDOWN));
  return result(true, slot.name === 'recovery' ? 'recovery_due' : 'window_due', now);
}
export const isDue = (source, state, now, options) => scheduleDecision(source, state, now, options).due;

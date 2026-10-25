import { taipeiDate, validDateOnly, addCalendarDays } from '../lib/time.js';
export const CALENDAR_EVENTS_KEY = 'dailyinfo.calendar.events.v1';
export const taipeiCalendarDay = taipeiDate;

// Timed event ends are exclusive; an event ending at midnight belongs to the preceding day.
export function todayCalendarEvents(events, date = new Date()) {
  const day = taipeiCalendarDay(date), start = `${day}T00:00`;
  return events.filter(event => event.allDay
    ? event.startDate <= day && event.endDate >= day
    : event.startDate <= day && (`${event.endDate}T${event.endTime}` > start
      || `${event.startDate}T${event.startTime}` === start))
    .sort((a, b) => `${a.startDate}T${a.startTime ?? '00:00'}`.localeCompare(`${b.startDate}T${b.startTime ?? '00:00'}`)
      || a.id.localeCompare(b.id));
}
export const EVENT_COLORS = Object.freeze({ teal: '#197969', blue: '#2863a3', violet: '#7150a4', rose: '#a44268', amber: '#94601e' });
export function validCalendarDate(value) {
  return typeof value === 'string' && /^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)
    && validDateOnly(value);
}
const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export function validateCalendarEvent(raw) {
  if (!raw || typeof raw.id !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(raw.id)) throw Error('行程識別碼無效。');
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(raw.title)) throw Error('行程標題必填，限 120 字且不能包含控制字元。');
  if (!validCalendarDate(raw.startDate) || !validCalendarDate(raw.endDate)) throw Error('請輸入有效日期（1900–2199 年）。');
  if (typeof raw.allDay !== 'boolean' || !Object.hasOwn(EVENT_COLORS, raw.color)) throw Error('全天設定或顏色無效。');
  if (raw.allDay ? raw.startTime !== null || raw.endTime !== null : !validTime(raw.startTime) || !validTime(raw.endTime)) throw Error('請輸入有效的開始與結束時間。');
  if (`${raw.endDate}T${raw.endTime ?? ''}` < `${raw.startDate}T${raw.startTime ?? ''}`) throw Error('結束日期／時間不得早於開始日期／時間。');
  return { id: raw.id, title: raw.title.trim(), startDate: raw.startDate, endDate: raw.endDate,
    allDay: raw.allDay, startTime: raw.startTime, endTime: raw.endTime, color: raw.color };
}
export function validateCalendarEvents(raw) {
  if (raw?.version !== 1 || !Array.isArray(raw.events) || raw.events.length > 10000) throw Error('行事曆資料格式無效。');
  const events = raw.events.map(validateCalendarEvent);
  if (new Set(events.map(event => event.id)).size !== events.length) throw Error('行程識別碼重複。');
  return { version: 1, events };
}
const parse = raw => {
  if (raw === null) return { version: 1, events: [] };
  if (raw.length > 1048576) throw Error('資料過大');
  return validateCalendarEvents(JSON.parse(raw));
};
export function loadCalendarEvents(storage) {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(CALENDAR_EVENTS_KEY);
    return { data: parse(raw), raw, locked: false, error: '' };
  } catch {
    return { data: { version: 1, events: [] }, raw: null, locked: true,
      error: '行事曆資料無法讀取或已損壞；原始資料未覆寫，編輯已停用。請檢查瀏覽器設定或還原備份後重新開啟此頁。' };
  }
}
export function saveCalendarEvents(events, expectedRaw, storage) {
  const data = validateCalendarEvents({ version: 1, events }), raw = JSON.stringify(data);
  if (raw.length > 1048576) throw Error('行事曆資料過大，未儲存；原有行程保留。');
  try {
    const target = storage ?? globalThis.localStorage;
    const current = target.getItem(CALENDAR_EVENTS_KEY); parse(current);
    if (current !== expectedRaw) throw Error('conflict');
    target.setItem(CALENDAR_EVENTS_KEY, raw);
  } catch {
    throw Error('儲存失敗：空間不足、禁止存取或其他分頁已修改資料。原有行程保留；請保留表單內容並檢查儲存設定或重新開啟此頁。');
  }
  return { data, raw, locked: false, error: '' };
}
export function calendarEventInput(value) {
  const event = validateCalendarEvent(value);
  const end = event.allDay ? addCalendarDays(event.endDate, 1) : `${event.endDate}T${event.endTime}`;
  return { id: event.id, title: event.title, allDay: event.allDay,
    start: event.allDay ? event.startDate : `${event.startDate}T${event.startTime}`, end,
    backgroundColor: EVENT_COLORS[event.color], borderColor: EVENT_COLORS[event.color], textColor: '#ffffff' };
}

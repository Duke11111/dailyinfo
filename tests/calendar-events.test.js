import { it, expect, vi } from 'vitest';
import { CALENDAR_EVENTS_KEY, loadCalendarEvents, saveCalendarEvents, validateCalendarEvent, validateCalendarEvents, calendarEventInput } from '../src/services/calendar-events.js';
const event = () => ({ id: 'test-1', title: '測試行程', startDate: '2026-10-20', endDate: '2026-10-21', allDay: true, startTime: null, endTime: null, color: 'blue' });
function storage(raw = null) { let value = raw; return { getItem: vi.fn(() => value), setItem: vi.fn((key, next) => { expect(key).toBe(CALENDAR_EVENTS_KEY); value = next; }) }; }
it('persists create, edit and delete through the isolated versioned key and restores', () => {
  const target = storage(); let saved = saveCalendarEvents([event()], null, target);
  expect(loadCalendarEvents(target).data.events[0]).toEqual(event());
  saved = saveCalendarEvents([{ ...event(), title: '已編輯' }], saved.raw, target);
  expect(loadCalendarEvents(target).data.events[0].title).toBe('已編輯');
  saveCalendarEvents([], saved.raw, target); expect(loadCalendarEvents(target).data.events).toEqual([]);
});
it.each([
  { title: '' }, { title: ' '.repeat(3) }, { title: '字'.repeat(121) }, { title: 'a\nb' },
  { startDate: '2026-02-30' }, { endDate: '2026-10-19' }, { color: 'url(evil)' }, { allDay: 'true' },
  { id: '../bad' }, { allDay: false, startTime: '25:00', endTime: '26:00' },
  { allDay: false, startDate: '2026-10-20', endDate: '2026-10-20', startTime: '10:00', endTime: '09:00' },
])('rejects malformed input %j', patch => { expect(() => validateCalendarEvent({ ...event(), ...patch })).toThrow(); });
it('keeps Taipei wall-clock times and accepts overnight events', () => {
  const value = { ...event(), allDay: false, startTime: '23:30', endTime: '00:30' };
  expect(calendarEventInput(value)).toMatchObject({ start: '2026-10-20T23:30', end: '2026-10-21T00:30', allDay: false });
});
it('converts inclusive all-day end dates, including leap days and year boundaries', () => {
  expect(calendarEventInput(event()).end).toBe('2026-10-22');
  expect(calendarEventInput({ ...event(), startDate: '2024-02-28', endDate: '2024-02-29' }).end).toBe('2024-03-01');
  expect(calendarEventInput({ ...event(), startDate: '2026-12-31', endDate: '2026-12-31' }).end).toBe('2027-01-01');
});
it.each(['broken', JSON.stringify({ version: 2, events: [] }), JSON.stringify({ version: 1, events: [event(), event()] }), JSON.stringify({ version: 1, events: [{ ...event(), color: 'bad' }] })])('locks corrupted storage and never overwrites it', raw => {
  const target = storage(raw); expect(loadCalendarEvents(target).locked).toBe(true);
  expect(() => saveCalendarEvents([], raw, target)).toThrow(); expect(target.setItem).not.toHaveBeenCalled(); expect(target.getItem()).toBe(raw);
});
it('preserves old data on quota failure and protects edits from another tab', () => {
  const old = JSON.stringify({ version: 1, events: [event()] }), target = storage(old);
  target.setItem.mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  expect(() => saveCalendarEvents([], old, target)).toThrow('儲存失敗'); expect(target.getItem()).toBe(old);
  target.setItem.mockClear(); expect(() => saveCalendarEvents([], null, target)).toThrow(); expect(target.setItem).not.toHaveBeenCalled();
});
it('reports denied storage access without claiming success', () => {
  const target = { getItem: () => { throw Error('denied'); }, setItem: vi.fn() };
  expect(loadCalendarEvents(target).locked).toBe(true); expect(() => saveCalendarEvents([], null, target)).toThrow('儲存失敗'); expect(target.setItem).not.toHaveBeenCalled();
});
it('rejects duplicate IDs and unknown versions', () => {
  expect(() => validateCalendarEvents({ version: 1, events: [event(), event()] })).toThrow();
  expect(() => validateCalendarEvents({ version: 2, events: [] })).toThrow();
});

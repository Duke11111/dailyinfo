// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountTodayAgenda } from '../src/components/today-agenda.js';
import { todayCalendarEvents, CALENDAR_EVENTS_KEY, EVENT_COLORS } from '../src/services/calendar-events.js';
import { mountCalendar } from '../src/pages/calendar.js';

const now = () => Date.parse('2026-10-20T16:15:00Z'); // Taiwan 10/21 00:15, UTC still 10/20.
const event = (id, patch = {}) => ({ id, title: id, startDate: '2026-10-21', endDate: '2026-10-21', allDay: false, startTime: '09:00', endTime: '10:00', color: 'teal', ...patch });
let host, storage, raw, dispose;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); raw = null;
  storage = { getItem: vi.fn(() => raw), setItem: vi.fn() };
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { dispose?.(); dispose = null; host.remove(); delete HTMLDialogElement.prototype.showModal; delete HTMLDialogElement.prototype.close; });
const seed = events => { raw = JSON.stringify({ version: 1, events }); };
const boot = () => { dispose = mountTodayAgenda(host, { storage, now }); };
it('selects Taipei today, sorts starts, includes all-day and spanning dates, excludes midnight endings', () => {
  const events = [event('late', { startTime: '17:00', endTime: '18:00' }), event('morning'),
    event('all-day', { allDay: true, startTime: null, endTime: null }),
    event('overnight', { startDate: '2026-10-20', startTime: '23:00', endTime: '01:00' }),
    event('spanning', { allDay: true, startDate: '2026-10-19', endDate: '2026-10-22', startTime: null, endTime: null }),
    event('ended', { startDate: '2026-10-20', endTime: '00:00' }),
    event('tomorrow', { startDate: '2026-10-22', endDate: '2026-10-22' })];
  expect(todayCalendarEvents(events, new Date(now())).map(e => e.id)).toEqual(['spanning', 'overnight', 'all-day', 'morning', 'late']);
});
it('includes a zero-duration event at midnight and excludes previous dates', () => {
  expect(todayCalendarEvents([event('instant', { startTime: '00:00', endTime: '00:00' }), event('past', { startDate: '2026-10-20', endDate: '2026-10-20' })], new Date(now())).map(e => e.id)).toEqual(['instant']);
});
it('renders five safely with time, color and event links, and an overflow entry', () => {
  seed(Array.from({ length: 7 }, (_, i) => event(`event-${i}`, { title: i === 0 ? '<img src=x onerror=alert(1)>' : `行程 ${i}` })));
  const before = raw; boot();
  expect(host.querySelectorAll('li')).toHaveLength(5); expect(host.textContent).toContain('另有 2 筆');
  expect(host.textContent).toContain('2026-10-21'); expect(host.textContent).toContain('09:00–10:00');
  expect(host.querySelector('li a').getAttribute('href')).toBe('#/calendar?event=event-0');
  expect(host.querySelector('li img')).toBeNull(); expect(host.textContent).toContain('<img');
  expect(host.querySelector('.today-agenda-color').style.backgroundColor).toBe('rgb(25, 121, 105)');
  expect(EVENT_COLORS.teal).toBe('#197969'); expect(raw).toBe(before); expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.getItem).toHaveBeenCalledWith(CALENDAR_EVENTS_KEY);
});
it('shows all-day and cross-midnight time labels', () => {
  seed([event('all', { allDay: true, startTime: null, endTime: null }), event('night', { startDate: '2026-10-20', startTime: '23:30', endTime: '00:30' })]); boot();
  expect(host.textContent).toContain('全天'); expect(host.textContent).toContain('2026-10-20 23:30～2026-10-21 00:30');
});
it('shows a friendly empty state and create entry without writing storage', () => {
  boot(); expect(host.textContent).toContain('今天還沒有安排');
  expect(host.querySelector('a[href="#/calendar?new=today"]')).not.toBeNull(); expect(storage.setItem).not.toHaveBeenCalled();
});
it('reports damaged or inaccessible storage without claiming no events or overwriting', () => {
  raw = '{broken'; boot(); expect(host.querySelector('[role="alert"]').textContent).toContain('損壞');
  expect(host.textContent).not.toContain('今天還沒有安排'); expect(raw).toBe('{broken'); expect(storage.setItem).not.toHaveBeenCalled();
  storage.getItem.mockImplementation(() => { throw Error('denied'); }); boot(); expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
it('reads current events on return to the overview without making another data store', () => {
  seed([event('old')]); boot(); dispose(); seed([event('new')]); boot();
  expect(host.textContent).toContain('new'); expect(host.textContent).not.toContain('old'); expect(storage.setItem).not.toHaveBeenCalled();
});
it('opens the exact stored event and correct month through a calendar deep link without writes', async () => {
  seed([event('selected', { startDate: '2026-09-30', endDate: '2026-10-21' })]);
  dispose = mountCalendar(host, { storage, hash: '#/calendar?event=selected' });
  await vi.waitFor(() => expect(host.querySelector('dialog')?.open).toBe(true));
  expect(host.querySelector('[name="title"]').value).toBe('selected');
  expect(host.querySelector('.fc-toolbar-title').textContent).toContain('9月'); expect(storage.setItem).not.toHaveBeenCalled();
});
it('handles missing or injected event IDs safely without writes', async () => {
  seed([event('safe')]); dispose = mountCalendar(host, { storage, hash: '#/calendar?event=%3Cimg%3E' });
  await vi.waitFor(() => expect(host.textContent).toContain('找不到指定行程'));
  expect(host.querySelector('dialog')).toBeNull(); expect(storage.setItem).not.toHaveBeenCalled();
});
it('supports today create entry and preserves corrupt storage on deep links', async () => {
  dispose = mountCalendar(host, { storage, hash: '#/calendar?new=today' });
  await vi.waitFor(() => expect(host.querySelector('dialog')?.open).toBe(true));
  expect(host.querySelector('[name="title"]').value).toBe(''); dispose(); raw = 'corrupt';
  dispose = mountCalendar(host, { storage, hash: '#/calendar?new=today' });
  await vi.waitFor(() => expect(host.querySelector('.fc-toolbar-title')).not.toBeNull());
  expect(host.querySelector('dialog')).toBeNull(); expect(raw).toBe('corrupt'); expect(storage.setItem).not.toHaveBeenCalled();
});

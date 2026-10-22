// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountCalendar } from '../src/pages/calendar.js';
import { CALENDAR_EVENTS_KEY } from '../src/services/calendar-events.js';
let host, dispose, storage, map;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-20T12:00:00Z');
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
  map = new Map(); storage = { getItem: key => map.get(key) ?? null, setItem: vi.fn((key, value) => map.set(key, value)) };
  host = document.createElement('div'); document.body.append(host);
});
afterEach(() => { dispose?.(); dispose = null; host?.remove(); delete HTMLDialogElement.prototype.showModal; delete HTMLDialogElement.prototype.close; vi.restoreAllMocks(); vi.useRealTimers(); });
async function mount(options = {}) { dispose = mountCalendar(host, { storage, ...options }); await vi.waitFor(() => expect(host.querySelector('.fc-toolbar-title')).not.toBeNull()); }
const field = name => host.querySelector(`[name="${name}"]`);
const submit = () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
function create(title = '測試行程') { host.querySelector('.calendar-add').click(); field('title').value = title; submit(); }
it('creates safely, navigates months, restores on remount, edits and confirms deletion', async () => {
  await mount();
  create(); expect(host.querySelector('.fc-event').textContent).toContain('測試行程');
  host.querySelector('.fc-next-button').click(); host.querySelector('.fc-prev-button').click(); expect(host.querySelector('.fc-event')).not.toBeNull();
  dispose(); await mount(); expect(host.querySelector('.fc-event')).not.toBeNull();
  host.querySelector('.fc-event').click(); field('title').value = '已修改'; field('color').value = 'rose'; submit();
  expect(host.querySelector('.fc-event').textContent).toContain('已修改');
  host.querySelector('.fc-event').click(); const remove = [...host.querySelectorAll('dialog button')].find(b => b.textContent === '刪除行程');
  remove.click(); expect(host.querySelector('.fc-event')).not.toBeNull();
  expect(document.activeElement.textContent).toBe('保留行程');
  [...host.querySelectorAll('dialog button')].find(b => b.textContent === '保留行程').click();
  expect(host.querySelector('.calendar-delete-confirm').hidden).toBe(true); expect(document.activeElement).toBe(remove); remove.click();
  [...host.querySelectorAll('dialog button')].find(b => b.textContent === '確認刪除').click(); expect(host.querySelector('.fc-event')).toBeNull();
  expect(JSON.parse(map.get(CALENDAR_EVENTS_KEY)).events).toEqual([]);
});
it('validates selected date fields and retains invalid form contents', async () => {
  await mount(); host.querySelector('.calendar-add').click();
  field('startDate').value = '2026-10-22'; field('title').value = '跨日'; field('endDate').value = '2026-10-21'; submit();
  expect(host.querySelector('[role="alert"]').textContent).toContain('不得早於'); expect(storage.setItem).not.toHaveBeenCalled(); expect(field('title').value).toBe('跨日');
});
it('never turns an XSS title into HTML', async () => {
  await mount(); create('<img src=x onerror=alert(1)>');
  expect(host.querySelector('.fc-event').textContent).toContain('<img'); expect(host.querySelector('.fc-event img')).toBeNull();
});
it('keeps a failed save in its dialog without pretending the event was added', async () => {
  await mount(); storage.setItem.mockImplementation(() => { throw Error('blocked'); }); create();
  expect(host.querySelector('dialog').open).toBe(true); expect(host.querySelector('[role="alert"]').textContent).toContain('儲存失敗'); expect(host.querySelector('.fc-event')).toBeNull();
});
it('locks corrupt storage without overwriting it', async () => {
  map.set(CALENDAR_EVENTS_KEY, 'corrupt'); await mount();
  expect(host.querySelector('.calendar-add').disabled).toBe(true); expect(host.textContent).toContain('編輯已停用'); expect(map.get(CALENDAR_EVENTS_KEY)).toBe('corrupt'); expect(storage.setItem).not.toHaveBeenCalled();
});

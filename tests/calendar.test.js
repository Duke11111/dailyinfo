// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountCalendar, taipeiCalendarDay } from '../src/pages/calendar.js';
let host, dispose;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-20T12:00:00Z');
  host = document.createElement('div'); document.body.append(host);
});
afterEach(() => { dispose?.(); dispose = null; host.remove(); vi.useRealTimers(); });
async function mount() {
  dispose = mountCalendar(host);
  await vi.waitFor(() => expect(host.querySelector('.fc-toolbar-title')).not.toBeNull());
}
it('renders a real Traditional Chinese month grid with correct weekdays and today', async () => {
  await mount();
  expect(host.querySelector('.fc-toolbar-title').textContent).toContain('2026年10月');
  expect([...host.querySelectorAll('.fc-col-header-cell')].map(x => x.textContent)).toEqual(['週日','週一','週二','週三','週四','週五','週六']);
  expect(host.querySelector('.fc-day-today').getAttribute('data-date')).toBe('2026-10-20');
  expect(host.querySelector('[data-date="2026-10-01"]').classList.contains('fc-day-thu')).toBe(true);
  expect(host.querySelectorAll('.fc-event')).toHaveLength(0);
});
it('moves both directions across years and returns to Taipei today', async () => {
  await mount();
  host.querySelector('.fc-prev-button').click(); expect(host.querySelector('.fc-toolbar-title').textContent).toContain('2026年9月');
  for (let i=0;i<4;i++) host.querySelector('.fc-next-button').click();
  expect(host.querySelector('.fc-toolbar-title').textContent).toContain('2027年1月');
  host.querySelector('.fc-today-button').click(); expect(host.querySelector('.fc-toolbar-title').textContent).toContain('2026年10月');
});
it('uses Taiwan civil dates across UTC midnight and year boundaries', () => {
  expect(taipeiCalendarDay(new Date('2026-10-20T16:01:00Z'))).toBe('2026-10-21');
  expect(taipeiCalendarDay(new Date('2026-12-31T16:01:00Z'))).toBe('2027-01-01');
});
it('destroys the view on route disposal without touching storage', async () => {
  const write = vi.spyOn(Storage.prototype, 'setItem');
  try { await mount(); dispose(); expect(host.children).toHaveLength(0); expect(write).not.toHaveBeenCalled(); }
  finally { write.mockRestore(); }
});
it('ignores a late module load after leaving the page', async () => {
  let finish; const create = vi.fn();
  dispose = mountCalendar(host, { loader: () => new Promise(resolve => { finish = resolve; }) });
  await Promise.resolve(); dispose(); finish([{ Calendar: create }, { default: {} }, { default: {} }]);
  await Promise.resolve(); expect(create).not.toHaveBeenCalled(); expect(host.children).toHaveLength(0);
});
it('contains module load failures within the calendar page', async () => {
  dispose = mountCalendar(host, { loader: () => Promise.reject(Error('offline')) });
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('載入失敗'));
});

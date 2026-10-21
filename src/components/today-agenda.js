import { loadCalendarEvents, todayCalendarEvents, taipeiCalendarDay, EVENT_COLORS } from '../services/calendar-events.js';

const el = (tag, text, className = '') => {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
};
const link = (text, href) => { const node = el('a', text); node.href = href; return node; };
export function mountTodayAgenda(host, { storage, now = Date.now } = {}) {
  const section = el('section', '', 'card today-agenda');
  section.setAttribute('aria-labelledby', 'today-agenda-title');
  const heading = el('h2', '今日行程'); heading.id = 'today-agenda-title';
  const header = el('div', '', 'overview-card-heading'); header.append(heading, link('查看行事曆 →', '#/calendar'));
  section.append(header, el('p', `${taipeiCalendarDay(new Date(now()))} · 臺灣時間 · 僅儲存於此瀏覽器`, 'overview-caption'));
  const saved = loadCalendarEvents(storage);
  if (saved.locked) {
    const error = el('p', saved.error, 'overview-error'); error.setAttribute('role', 'alert'); section.append(error);
  } else {
    const events = todayCalendarEvents(saved.data.events, new Date(now()));
    if (!events.length) section.append(el('p', '今天還沒有安排，留一點時間給自己。'), link('新增今日行程 →', '#/calendar?new=today'));
    else {
      const list = el('ul', '', 'overview-list today-agenda-list');
      events.slice(0, 5).forEach(event => {
        const item = el('li');
        const dot = el('span', '', 'today-agenda-color'); dot.style.backgroundColor = EVENT_COLORS[event.color]; dot.setAttribute('aria-hidden', 'true');
        const title = link(event.title, `#/calendar?event=${encodeURIComponent(event.id)}`);
        const sameDay = event.startDate === event.endDate;
        const time = event.allDay ? `全天${sameDay ? '' : ` · ${event.startDate}～${event.endDate}`}`
          : sameDay ? `${event.startTime}–${event.endTime}` : `${event.startDate} ${event.startTime}～${event.endDate} ${event.endTime}`;
        item.append(dot, title, el('p', time, 'overview-caption')); list.append(item);
      });
      section.append(list);
      if (events.length > 5) section.append(link(`另有 ${events.length - 5} 筆，前往行事曆查看 →`, '#/calendar'));
    }
  }
  host.replaceChildren(section);
  return () => section.remove();
}

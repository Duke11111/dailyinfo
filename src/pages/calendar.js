import '../calendar.css';
import { loadCalendarEvents, saveCalendarEvents, validateCalendarEvent, calendarEventInput, taipeiCalendarDay } from '../services/calendar-events.js';

export { taipeiCalendarDay } from '../services/calendar-events.js';
const loadCalendar = () => Promise.all([
  import('@fullcalendar/core'), import('@fullcalendar/daygrid'), import('@fullcalendar/core/locales/zh-tw'), import('@fullcalendar/interaction'),
]);
export function mountCalendar(host, { loader = loadCalendar, storage, hash = window.location.hash } = {}) {
  let disposed = false, calendar;
  let saved = loadCalendarEvents(storage), dialog = null;
  const params = new URLSearchParams(hash.split('?')[1] ?? '');
  const requestedId = params.get('event');
  const selected = saved.data.events.find(event => event.id === requestedId);
  const section = document.createElement('section'); section.className = 'card calendar-page';
  section.setAttribute('aria-label', '個人行事曆');
  const note = document.createElement('p'); note.className = 'calendar-note';
  note.textContent = '行程日期與時間皆以臺灣時間表示。資料僅存在目前瀏覽器，不會傳送至第三方或跨裝置同步。';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '正在載入行事曆…';
  const view = document.createElement('div'); view.className = 'calendar-view';
  const notice = document.createElement('p'); notice.setAttribute('role', 'status'); notice.textContent = saved.error;
  const add = document.createElement('button'); add.type = 'button'; add.className = 'primary calendar-add'; add.textContent = '新增行程'; add.disabled = true;
  add.addEventListener('click', () => edit(taipeiCalendarDay()));
  section.append(note, add, notice, status, view); host.replaceChildren(section);
  function persist(events) {
    if (saved.locked) throw Error(saved.error);
    saved = saveCalendarEvents(events, saved.raw, storage);
    calendar.removeAllEvents(); calendar.addEventSource(saved.data.events.map(calendarEventInput));
    notice.textContent = '行程已儲存於此瀏覽器。';
  }
  function edit(day, existing) {
    if (disposed || saved.locked || !calendar) return;
    dialog?.remove(); dialog = document.createElement('dialog'); dialog.className = 'calendar-dialog';
    const heading = document.createElement('h2'); heading.id = 'calendar-dialog-title'; heading.textContent = existing ? '查看／編輯行程' : '新增行程';
    dialog.setAttribute('aria-labelledby', heading.id);
    const form = document.createElement('form'); form.noValidate = true;
    const fields = {};
    function field(key, label, type, value) {
      const wrapper = document.createElement('label'); wrapper.textContent = label;
      const input = document.createElement('input'); input.type = type; input.name = key;
      if (type === 'checkbox') input.checked = value; else input.value = value;
      fields[key] = input; wrapper.append(input); form.append(wrapper); return input;
    }
    field('title', '行程標題（必填，最多 120 字）', 'text', existing?.title ?? '').maxLength = 120;
    fields.title.required = true;
    field('startDate', '開始日期', 'date', existing?.startDate ?? day);
    field('endDate', '結束日期（全天含此日）', 'date', existing?.endDate ?? day);
    field('allDay', '全天行程', 'checkbox', existing?.allDay ?? true);
    field('startTime', '開始時間（臺灣）', 'time', existing?.startTime ?? '09:00');
    field('endTime', '結束時間（臺灣）', 'time', existing?.endTime ?? '10:00');
    const colorLabel = document.createElement('label'); colorLabel.textContent = '行程顏色';
    const color = document.createElement('select'); color.name = 'color';
    for (const [value, label] of [['teal','森林綠'],['blue','海洋藍'],['violet','暮光紫'],['rose','玫瑰紅'],['amber','琥珀棕']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; color.append(option);
    }
    color.value = existing?.color ?? 'teal'; colorLabel.append(color); form.append(colorLabel);
    const error = document.createElement('p'); error.className = 'calendar-form-error'; error.setAttribute('role', 'alert');
    const toggleTime = () => { fields.startTime.disabled = fields.endTime.disabled = fields.allDay.checked; };
    fields.allDay.addEventListener('change', toggleTime); toggleTime();
    const actions = document.createElement('div'); actions.className = 'calendar-actions';
    function button(text, action) {
      const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.addEventListener('click', action); actions.append(node); return node;
    }
    const opener = document.activeElement;
    const close = () => dialog.close();
    dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus(); else add.focus(); });
    button('取消', close);
    if (existing) {
      const confirmation = document.createElement('div'); confirmation.className = 'calendar-delete-confirm'; confirmation.hidden = true;
      const warning = document.createElement('p'); warning.textContent = '確定刪除此行程？此操作無法復原。'; warning.setAttribute('role', 'alert');
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '確認刪除'; remove.className = 'calendar-delete';
      const keep = document.createElement('button'); keep.type = 'button'; keep.textContent = '保留行程';
      const startDelete = button('刪除行程', () => { confirmation.hidden = false; keep.focus(); });
      startDelete.classList.add('calendar-delete');
      keep.addEventListener('click', () => { confirmation.hidden = true; startDelete.focus(); });
      remove.addEventListener('click', () => {
        try { persist(saved.data.events.filter(event => event.id !== existing.id)); close(); }
        catch (failure) { error.textContent = failure.message; }
      });
      confirmation.append(warning, keep, remove); form.append(confirmation);
    }
    const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'primary'; submit.textContent = '儲存行程'; actions.append(submit);
    form.addEventListener('submit', event => {
      event.preventDefault(); error.textContent = '';
      try {
        const allDay = fields.allDay.checked;
        const value = validateCalendarEvent({ id: existing?.id ?? crypto.randomUUID(), title: fields.title.value,
          startDate: fields.startDate.value, endDate: fields.endDate.value, allDay,
          startTime: allDay ? null : fields.startTime.value, endTime: allDay ? null : fields.endTime.value, color: color.value });
        persist(existing ? saved.data.events.map(item => item.id === existing.id ? value : item) : [...saved.data.events, value]); close();
      } catch (failure) { error.textContent = failure.message; }
    });
    form.append(error, actions); dialog.append(heading, form); section.append(dialog); dialog.showModal(); fields.title.focus();
  }
  Promise.resolve().then(loader).then(([{ Calendar }, { default: dayGrid }, { default: zhTw }, interaction]) => {
    if (disposed) return;
    calendar = new Calendar(view, {
      plugins: [dayGrid, interaction.default], locale: zhTw, initialView: 'dayGridMonth',
      // Date-only view: supply Taipei's civil date without another timezone plugin.
      timeZone: 'UTC', now: () => taipeiCalendarDay(),
      initialDate: selected?.startDate ?? taipeiCalendarDay(),
      headerToolbar: { left: 'prev,next', center: 'title', right: 'today' },
      buttonText: { today: '今天', prev: '上個月', next: '下個月' },
      buttonHints: { prev: '上個月', next: '下個月', today: '返回今天' },
      titleFormat: { year: 'numeric', month: 'long' },
      dayHeaderFormat: { weekday: 'short' }, firstDay: 0,
      height: 'auto', fixedWeekCount: false, editable: false, selectable: false,
      navLinks: false, events: saved.data.events.map(calendarEventInput),
      dateClick: info => edit(info.dateStr.slice(0, 10)),
      eventClick: info => { const value = saved.data.events.find(event => event.id === info.event.id); if (value) edit(value.startDate, value); },
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false }, displayEventEnd: true,
      eventContent: info => {
        const node = document.createElement('span'); node.className = 'calendar-event-preview'; node.textContent = `${info.timeText ? info.timeText + ' ' : ''}${info.event.title}`;
        return { domNodes: [node] };
      },
    });
    calendar.render(); status.remove(); add.disabled = saved.locked;
    if (selected) edit(selected.startDate, selected);
    else if (requestedId) notice.textContent = saved.error || '找不到指定行程，可能已刪除；原有資料未變更。';
    else if (params.get('new') === 'today') edit(taipeiCalendarDay());
  }).catch(() => {
    if (disposed) return;
    calendar?.destroy(); calendar = null;
    status.setAttribute('role', 'alert'); status.textContent = '行事曆載入失敗，請重新整理頁面。其他功能不受影響。';
  });
  return () => { disposed = true; if (dialog?.open) dialog.close(); calendar?.destroy(); calendar = null; section.remove(); };
}

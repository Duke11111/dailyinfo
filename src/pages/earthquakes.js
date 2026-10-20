import { EQ_SOURCE, EQ_SOURCE_URL, EQ_TYPES, earthquakeStore, filterEarthquakes } from '../services/earthquakes.js';
import { formatEarthquakeTime as formatTime } from '../lib/earthquake-format.js';

const el = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const value = (number, unit = '') => number === null || number === undefined ? '未提供' : `${number}${unit}`;
const time = raw => raw ? `${formatTime(raw)}（臺灣時間）` : '未提供';
const types = event => [...new Set(event.reports.map(report => EQ_TYPES[report.dataset]))].join('／');
function button(label, action, className = 'eq-button') { const node = el('button', label, className); node.type = 'button'; node.addEventListener('click', action); return node; }
function reportLink(report) {
  if (!report.url) return el('span', '官方報告連結未提供');
  const link = el('a', `官方報告：${EQ_TYPES[report.dataset]}`); link.href = report.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
}
const defaultMapFactory = async (host, options) => (await import('../components/earthquake-map.js')).createEarthquakeMap(host, options);
export function mountEarthquakes(host, { store = earthquakeStore, mapFactory = defaultMapFactory, now = Date.now, initialEventId = null } = {}) {
  let snapshot = store.peek(), filtered = snapshot?.events ?? [], selected = null, page = 0, filters = {}, alive = true, loading = false, error = '', request = 0, readAt = null, cached = false;
  let map = null, mapStarting = false, initialSelectionApplied = false;
  const size = 8;
  const shell = el('div', '', 'earthquake-page'), statusCard = el('section', '', 'card eq-status-card'); statusCard.setAttribute('aria-label', '地震資料狀態');
  const status = el('div'); status.setAttribute('role', 'status'); const failure = el('p', '', 'eq-error'); failure.setAttribute('role', 'alert');
  const refresh = button('重新讀取地震快照', () => load(true)), source = el('a', `資料來源：${EQ_SOURCE}`); source.href = EQ_SOURCE_URL; source.target = '_blank'; source.rel = 'noopener noreferrer';
  statusCard.append(el('span', 'TAIWAN EARTHQUAKE REPORTS', 'eyebrow'), status, failure, refresh, el('p', '按鈕只重讀網站已發布的快照，不會即時更新氣象署 API。查詢限目前已取得的紀錄；不是完整歷史資料庫、地震預測或即時預警。', 'eq-help'), source);
  const form = el('form', '', 'card eq-filter'); form.setAttribute('aria-label', '地震查詢條件'); const controls = el('div', '', 'eq-filter-grid');
  function field(label, name, type) {
    const wrapper = el('label', label); const input = el('input'); input.type = type; input.name = name;
    if (type === 'number') { input.min = '0'; input.max = '10'; input.step = '0.1'; }
    if (type === 'search') { input.maxLength = 100; input.placeholder = '震央位置或有觀測震度的縣市'; }
    wrapper.append(input); controls.append(wrapper); return input;
  }
  field('地區／縣市關鍵字', 'query', 'search'); field('最小規模', 'minMagnitude', 'number'); field('最大規模', 'maxMagnitude', 'number'); field('開始日期', 'startDate', 'date'); field('結束日期', 'endDate', 'date');
  const typeLabel = el('label', '報告類型'), type = el('select'); type.name = 'type'; type.add(new Option('全部類型', 'all')); Object.entries(EQ_TYPES).forEach(([key, label]) => type.add(new Option(label, key))); typeLabel.append(type); controls.append(typeLabel);
  const actions = el('div', '', 'eq-filter-actions'), submit = el('button', '套用篩選', 'primary'); submit.type = 'submit';
  const clear = button('清除篩選', () => { form.reset(); filters = {}; page = 0; applyFilters(); }); actions.append(submit, clear);
  const filterError = el('p', '', 'eq-error'); filterError.setAttribute('role', 'alert'); form.append(controls, actions, filterError);
  form.addEventListener('submit', event => { event.preventDefault(); filters = Object.fromEntries(new FormData(form)); page = 0; applyFilters(); });
  const workspace = el('div', '', 'eq-workspace'), mapCard = el('section', '', 'card eq-map-card');
  const mapHeading = el('div', '', 'eq-map-heading'), reset = button('回到臺灣', () => map?.reset()); reset.disabled = true; mapHeading.append(el('h2', '臺灣震央地圖'), reset);
  const mapHost = el('div', '', 'eq-map'); mapHost.setAttribute('aria-label', '臺灣地震震央互動地圖');
  const mapStatus = el('p', '取得資料後載入地圖；地圖失敗不影響列表與詳情。', 'eq-help'); mapStatus.setAttribute('role', 'status');
  mapCard.append(mapHeading, mapHost, mapStatus, el('p', '圓越大代表規模越大；實線為顯著有感，虛線為小區域有感。規模不同於震度。地圖顯示全部篩選結果，不受列表分頁影響。', 'eq-help'));
  const detail = el('section', '', 'card eq-detail'); detail.setAttribute('aria-label', '地震詳細資訊'); workspace.append(mapCard, detail);
  const listCard = el('section', '', 'card eq-list-card'), count = el('p', '', 'eq-result-count'); count.setAttribute('role', 'status');
  const tableHost = el('div', '', 'eq-table-scroll'); tableHost.setAttribute('role', 'region'); tableHost.setAttribute('aria-label', '地震列表，可水平捲動'); tableHost.tabIndex = 0;
  const pagination = el('nav', '', 'eq-pagination'); pagination.setAttribute('aria-label', '地震分頁'); listCard.append(count, tableHost, pagination);
  shell.append(statusCard, form, workspace, listCard); host.replaceChildren(shell);
  function renderStatus() {
    status.replaceChildren(); refresh.disabled = loading; refresh.textContent = loading ? '地震快照讀取中…' : '重新讀取地震快照';
    if (loading) status.append(el('p', '正在讀取地震資料…'));
    if (snapshot) {
      const events = snapshot.events;
      status.append(el('p', `${events.length} 筆官方地震紀錄`, 'eq-status-title'), el('p', `發生時間範圍：${events.length ? `${time(events.at(-1).originTime)} 至 ${time(events[0].originTime)}` : '未提供'}`, 'eq-help'), el('p', `快照擷取：${time(snapshot.fetchedAt)}`, 'eq-help'));
      if (now() - Date.parse(snapshot.fetchedAt) > 86400000) status.append(el('p', '快照已超過 24 小時，可能過期，需維護者更新及發布。', 'eq-stale'));
      if (readAt !== null) status.append(el('p', `網頁讀取：${time(new Date(readAt).toISOString())}${cached ? ' · 共用快取' : ''}`, 'eq-help'));
    }
    failure.textContent = error;
  }
  async function ensureMap() {
    if (map || mapStarting || !snapshot) return;
    mapStarting = true; mapStatus.textContent = '震央地圖載入中…';
    try {
      const next = await mapFactory(mapHost, { onSelect: event => { if (alive) choose(event, false); }, onStatus: text => { if (alive) mapStatus.textContent = text; } });
      if (!alive) { next.destroy(); return; }
      map = next; reset.disabled = false; map.setEvents(filtered); map.select(selected?.id, Boolean(initialEventId && selected?.id === initialEventId));
      if (mapStatus.textContent === '震央地圖載入中…') mapStatus.textContent = '地圖元件已載入，底圖載入中…';
    } catch { if (alive) mapStatus.textContent = '地圖載入失敗；地震列表、搜尋及詳細資料仍可使用。'; }
  }
  function choose(event, focus = true) {
    selected = event; const index = filtered.findIndex(item => item.id === event.id); if (index >= 0) page = Math.floor(index / size);
    renderTable(); renderDetail(); map?.select(event.id, focus);
  }
  function renderDetail() {
    detail.replaceChildren(el('h2', '地震詳細資訊'));
    if (!selected) { detail.append(el('p', '請選擇列表紀錄或地圖震央，查看官方觀測資料。', 'eq-help')); return; }
    detail.append(el('h3', selected.location), el('span', types(selected), 'badge'));
    const list = el('dl', '', 'eq-detail-grid');
    for (const [label, content] of [['發生時間', time(selected.originTime)], ['官方報告時間', time(selected.reportTime)], ['緯度／經度', `${selected.latitude} / ${selected.longitude}`], ['地震規模', `${value(selected.magnitude)} · ${selected.magnitudeType ?? '類型未提供'}`], ['震源深度', value(selected.depth, ' km')], ['最大觀測震度', selected.maxIntensity ?? '未提供']]) {
      const item = el('div'); item.append(el('dt', label), el('dd', content)); list.append(item);
    }
    detail.append(list, el('h3', '官方提供的各縣市觀測震度'));
    const areas = el('ul', '', 'eq-intensities'); selected.areas.forEach(area => areas.append(el('li', `${area.county}：${area.intensity ?? '未提供'}`))); detail.append(selected.areas.length ? areas : el('p', '縣市觀測震度未提供', 'eq-help'));
    detail.append(el('p', '震度依官方觀測資料呈現；未列出的縣市表示本筆未提供，不代表沒有搖晃，亦非由規模推算。', 'eq-help'));
    for (const report of selected.reports) { const row = el('p', '', 'eq-help'); row.append(reportLink(report), document.createTextNode(` · 報告時間：${time(report.issuedAt)}`)); detail.append(row); }
    detail.append(el('p', `來源：${EQ_SOURCE} · 快照擷取：${time(snapshot.fetchedAt)}`, 'eq-help'));
  }
  function renderTable() {
    const pages = Math.max(1, Math.ceil(filtered.length / size)); page = Math.min(page, pages - 1);
    count.textContent = `篩選結果 ${filtered.length} 筆／目前 ${snapshot?.events.length ?? 0} 筆 · 發生時間由新到舊 · 第 ${page + 1} / ${pages} 頁`;
    tableHost.replaceChildren(); pagination.replaceChildren();
    if (!filtered.length) { tableHost.append(el('p', loading ? '正在載入地震紀錄…' : filterError.textContent ? '請修正查詢條件。' : '沒有符合條件的地震紀錄；請調整或清除篩選。', 'eq-empty')); return; }
    const table = el('table', '', 'eq-table'), head = el('thead'), tr = el('tr');
    ['發生時間（臺灣）', '震央位置', '規模', '深度', '最大觀測震度', '報告類型', '官方報告'].forEach(label => { const th = el('th', label); th.scope = 'col'; tr.append(th); }); head.append(tr); table.append(head);
    const body = el('tbody');
    for (const event of filtered.slice(page * size, (page + 1) * size)) {
      const row = el('tr'); if (selected?.id === event.id) row.classList.add('eq-active-row');
      row.append(el('td', formatTime(event.originTime)));
      const location = el('td'), open = button(event.location, () => choose(event), 'eq-event-button'); open.setAttribute('aria-label', `查看地震：${formatTime(event.originTime)} ${event.location}`); open.setAttribute('aria-pressed', String(selected?.id === event.id)); location.append(open); row.append(location);
      row.append(el('td', value(event.magnitude)), el('td', value(event.depth, ' km')), el('td', event.maxIntensity ?? '未提供'), el('td', types(event)));
      const links = el('td'); event.reports.forEach(report => { const p = el('div'); p.append(reportLink(report)); links.append(p); }); row.append(links); body.append(row);
    }
    table.append(body); tableHost.append(table);
    if (pages > 1) {
      const previous = button('上一頁', () => { page--; renderTable(); }), next = button('下一頁', () => { page++; renderTable(); }); previous.disabled = page === 0; next.disabled = page === pages - 1; pagination.append(previous, el('span', `${page + 1} / ${pages}`), next);
    }
  }
  function applyFilters() {
    filterError.textContent = '';
    try { filtered = filterEarthquakes(snapshot?.events ?? [], filters); } catch (error) { filtered = []; filterError.textContent = error.message; }
    if (selected && !filtered.some(event => event.id === selected.id)) selected = null;
    else if (selected) selected = filtered.find(event => event.id === selected.id);
    map?.setEvents(filtered); map?.select(selected?.id, false); renderTable(); renderDetail();
  }
  async function load(force = false) {
    const token = ++request; loading = true; error = ''; renderStatus(); renderTable(); renderDetail();
    try {
      const result = await store.load({ force });
      if (!alive || token !== request) return;
      snapshot = result.data; readAt = result.readAt ?? null; cached = result.cached; applyFilters();
      if (!initialSelectionApplied) {
        initialSelectionApplied = true;
        const target = filtered.find(event => event.id === initialEventId);
        if (target) {
          choose(target, true);
          detail.tabIndex = -1; detail.focus({ preventScroll: true }); detail.scrollIntoView?.({ block: 'start' });
        }
      }
      ensureMap();
    }
    catch (failure) { if (alive && token === request) error = `${failure.message} 既有快照與其他模組資料均未清除。`; }
    finally { if (alive && token === request) { loading = false; renderStatus(); renderTable(); } }
  }
  load();
  return () => { alive = false; request++; map?.destroy(); };
}

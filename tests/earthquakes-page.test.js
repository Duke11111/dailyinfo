// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountEarthquakes } from '../src/pages/earthquakes.js';
import { eqFixture, eqCaptured } from './fixtures/earthquakes.js';
import { applySettings } from '../src/services/settings.js';
let dispose, map, options;
const click = label => [...document.querySelectorAll('button')].find(button => button.textContent === label).click();
const settle = () => vi.waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(2));
function boot(overrides = {}) {
  const store = { peek: () => null, load: vi.fn(async () => ({ data: eqFixture(), readAt: Date.parse(eqCaptured), cached: false })), ...overrides };
  map = { setEvents: vi.fn(), select: vi.fn(), reset: vi.fn(), destroy: vi.fn() };
  dispose = mountEarthquakes(document.querySelector('#host'), { store, now: () => Date.parse(eqCaptured), mapFactory: async (_host, nextOptions) => { options = nextOptions; return map; } }); return store;
}
const fill = (name, value) => { document.querySelector(`[name="${name}"]`).value = value; };
const submit = () => document.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
beforeEach(() => { document.body.innerHTML = '<div id="host"></div>'; localStorage.clear(); });
afterEach(() => dispose?.());
it('renders real field roles, source/range and consistent map/list records', async () => {
  boot(); await settle(); await vi.waitFor(() => expect(map.setEvents).toHaveBeenCalled()); expect(document.querySelector('.eq-status-card').textContent).toContain('中央氣象署'); expect(document.querySelector('.eq-status-card').textContent).toContain('不會即時更新');
  expect(map.setEvents.mock.calls.at(-1)[0]).toHaveLength(2); expect(document.querySelector('table').textContent).toContain('最大觀測震度');
});
it('filters multiple conditions and clears them without changing localStorage', async () => {
  localStorage.setItem('dailyinfo.watchlists.v1', 'preserve'); boot(); await settle(); fill('query', '宜蘭'); fill('minMagnitude', '4.5'); fill('startDate', '2026-10-17'); fill('endDate', '2026-10-17'); fill('type', 'E-A0016-001'); submit();
  expect(document.querySelectorAll('tbody tr')).toHaveLength(1); expect(map.setEvents.mock.calls.at(-1)[0]).toHaveLength(1); expect(localStorage.getItem('dailyinfo.watchlists.v1')).toBe('preserve'); click('清除篩選'); expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
});
it('shows no results and rejects reversed filter ranges', async () => {
  boot(); await settle(); fill('query', '不存在'); submit(); expect(document.querySelector('.eq-empty').textContent).toContain('沒有符合'); fill('query', ''); fill('minMagnitude', '6'); fill('maxMagnitude', '3'); submit(); expect(document.querySelector('.eq-filter [role=alert]').textContent).toContain('最小規模');
});
it('selects a list record, locates it on the map and displays official details', async () => {
  boot(); await settle(); document.querySelector('.eq-event-button').click(); expect(map.select).toHaveBeenLastCalledWith(eqFixture().events[0].id, true);
  const detail = document.querySelector('.eq-detail'); expect(detail.textContent).toContain('芮氏規模'); expect(detail.textContent).toContain('宜蘭縣：2級'); expect(detail.textContent).not.toContain('臺南市：5強'); expect(detail.querySelector('a').rel).toContain('noopener');
});
it('updates list selection and detail when a marker is clicked', async () => {
  boot(); await settle(); await vi.waitFor(() => expect(options).toBeTruthy()); options.onSelect(eqFixture().events[1]); expect(document.querySelector('.eq-detail').textContent).toContain('花蓮縣豐濱鄉'); expect(document.querySelector('.eq-active-row').textContent).toContain('花蓮');
});
it('preserves loaded records and local data after manual refresh fails', async () => {
  const store = boot(); await settle(); localStorage.setItem('dailyinfo.news.favorites.v1', 'preserve'); store.load.mockRejectedValueOnce(Error('offline')); click('重新讀取地震快照'); await vi.waitFor(() => expect(document.querySelector('.eq-status-card [role=alert]').textContent).toContain('offline')); expect(document.querySelectorAll('tbody tr')).toHaveLength(2); expect(localStorage.getItem('dailyinfo.news.favorites.v1')).toBe('preserve');
});
it('isolates map initialization failure from working list/details', async () => {
  dispose = mountEarthquakes(document.querySelector('#host'), { store: { peek: () => null, load: async () => ({ data: eqFixture() }) }, mapFactory: async () => { throw Error('tiles'); } });
  await settle(); await vi.waitFor(() => expect(document.querySelector('.eq-map-card').textContent).toContain('地圖載入失敗')); document.querySelector('.eq-event-button').click(); expect(document.querySelector('.eq-detail').textContent).toContain('芮氏規模');
});
it('shows loading, source failure and empty snapshot states', async () => {
  let finish; boot({ load: () => new Promise(resolve => { finish = resolve; }) }); expect(document.querySelector('.eq-status-card').textContent).toContain('正在讀取'); finish({ data: { ...eqFixture(), events: [] } }); await vi.waitFor(() => expect(document.querySelector('.eq-status-title')).not.toBeNull()); expect(document.querySelector('.eq-empty').textContent).toContain('沒有符合');
  dispose(); boot({ load: async () => { throw Error('invalid data'); } }); await vi.waitFor(() => expect(document.querySelector('.eq-status-card [role=alert]').textContent).toContain('invalid data'));
});
it('does not inject API HTML and follows existing theme/font settings', async () => {
  const data = eqFixture(); data.events[0].location = '<img src=x onerror=alert(1)>'; applySettings({ mode: 'dark', accent: 'violet', fontSize: 'large' }); boot({ load: async () => ({ data }) }); await settle(); document.querySelector('.eq-event-button').click(); expect(document.querySelector('.eq-detail').textContent).toContain('<img'); expect(document.querySelector('#host img')).toBeNull(); expect(document.documentElement.dataset).toMatchObject({ theme: 'dark', accent: 'violet', fontSize: 'large' });
});
it('ignores late snapshot responses after unmount', async () => {
  let finish; boot({ load: () => new Promise(resolve => { finish = resolve; }) }); dispose(); document.querySelector('#host').replaceChildren(); finish({ data: eqFixture() }); await Promise.resolve(); expect(document.querySelector('#host').textContent).toBe('');
});
it('marks a stale snapshot and paginates without removing matching map events', async () => {
  const data = eqFixture(); data.fetchedAt = '2026-10-17T00:00:00.000Z';
  data.events = Array.from({ length: 10 }, (_, i) => ({ ...data.events[0], id: `ui-test-${i}` }));
  boot({ load: async () => ({ data }) });
  await vi.waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(8)); expect(document.querySelector('.eq-stale').textContent).toContain('超過 24 小時');
  click('下一頁'); expect(document.querySelectorAll('tbody tr')).toHaveLength(2); expect(map.setEvents.mock.calls.at(-1)[0]).toHaveLength(10);
});

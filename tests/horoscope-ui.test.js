// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountHoroscope } from '../src/components/horoscope.js';
import { SIGNS, HOROSCOPE_KEY, loadDefaultSign } from '../src/services/horoscope.js';
let host, dispose;
const data = () => ({ fetchedAt: '2026-10-20T01:00:00Z', readings: SIGNS.map(s => ({ sign: s.code, date: '2026-10-20', text: `<img src=x onerror=alert(1)> Test only ${s.code}` })) });
const service = () => ({ load: vi.fn(async () => ({ data: data(), readAt: Date.parse('2026-10-20T01:01:00Z') })) });
const boot = options => { dispose = mountHoroscope(host, { store: service(), now: () => Date.parse('2026-10-20T01:02:00Z'), ...options }); };
const click = text => [...host.querySelectorAll('button')].find(b => b.textContent === text).click();
function select(value) { const el = host.querySelector('select'); el.value = value; el.dispatchEvent(new Event('change')); }
beforeEach(() => { document.body.innerHTML = '<div id="host"></div>'; host = document.querySelector('#host'); localStorage.clear(); });
afterEach(() => dispose?.());
it('previews the complete original text and toggles accessibly without losing keyboard focus or writing storage', async () => {
  boot(); await vi.waitFor(() => expect(host.querySelector('.horoscope-reading')).not.toBeNull());
  const text = host.querySelector('.horoscope-reading'), original = text.textContent;
  const toggle = [...host.querySelectorAll('button')].find(b => b.textContent === '展開完整運勢');
  expect(text.classList.contains('is-collapsed')).toBe(true);
  expect(toggle.getAttribute('aria-controls')).toBe(text.id);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.focus(); toggle.click();
  expect(document.activeElement).toBe(toggle);
  expect(toggle.textContent).toBe('收合運勢');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(text.classList.contains('is-collapsed')).toBe(false);
  toggle.click(); expect(text.textContent).toBe(original);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(localStorage.length).toBe(0);
});
it('keeps stale warnings, source dates, retrieval times and attribution outside the collapsed reading', async () => {
  boot({ now: () => Date.parse('2026-10-21T00:00:00Z') });
  await vi.waitFor(() => expect(host.querySelector('.horoscope-reading')).not.toBeNull());
  const text = host.querySelector('.horoscope-reading');
  const warning = host.querySelector('[role="status"] > strong');
  expect(warning.textContent).toContain('非今日資料');
  expect(warning.textContent).toContain('來源日期 2026-10-20');
  expect(text.contains(warning)).toBe(false);
  expect(host.textContent).toContain('快照擷取'); expect(host.textContent).toContain('網頁讀取');
  expect(host.querySelectorAll('a[target="_blank"]')).toHaveLength(2);
  click('展開完整運勢'); click('收合運勢');
  expect(warning.hidden).toBe(false); expect(warning.isConnected).toBe(true);
});
it('resets only the preview when browsing another sign and preserves the saved default', async () => {
  boot(); click('儲存我的星座');
  await vi.waitFor(() => expect(host.querySelector('.horoscope-reading')).not.toBeNull());
  click('展開完整運勢'); select('leo');
  expect(host.querySelector('[aria-expanded]').getAttribute('aria-expanded')).toBe('false');
  expect(loadDefaultSign().defaultSign).toBe('aries');
  click('回到我的星座'); expect(host.querySelector('select').value).toBe('aries');
});
it('does not offer a reading toggle when no reading is available', async () => {
  boot({ store: { load: async () => ({ data: { ...data(), readings: [] }, readAt: Date.now() }) } });
  await vi.waitFor(() => expect(host.textContent).toContain('目前沒有可用'));
  expect(host.querySelector('[aria-expanded]')).toBeNull();
});
it('first use, skip and temporary browsing never write storage', async () => { boot(); expect(host.querySelectorAll('option')).toHaveLength(12); click('略過設定'); select('pisces'); await vi.waitFor(() => expect(host.textContent).toContain('Test only pisces')); expect(localStorage.length).toBe(0); expect(host.textContent).toContain('已略過'); });
it('saves default explicitly, browses others, returns, changes default and restores on reload', async () => {
  boot(); select('leo'); click('儲存我的星座'); expect(loadDefaultSign().defaultSign).toBe('leo'); select('taurus'); expect(loadDefaultSign().defaultSign).toBe('leo'); click('回到我的星座'); expect(host.querySelector('select').value).toBe('leo'); select('cancer'); click('設為預設星座'); expect(loadDefaultSign().defaultSign).toBe('cancer'); select('virgo'); dispose(); boot(); expect(host.querySelector('select').value).toBe('cancer');
});
it('late asynchronous snapshot uses latest viewSign and renders text safely without scores', async () => { let done; boot({ store: { load: () => new Promise(resolve => { done = resolve; }) } }); select('leo'); select('libra'); done({ data: data(), readAt: Date.now() }); await vi.waitFor(() => expect(host.textContent).toContain('Test only libra')); expect(host.textContent).not.toContain('Test only leo'); expect(host.querySelector('img')).toBeNull(); expect(host.textContent).not.toContain('星級'); expect(host.querySelector('.horoscope-reading').lang).toBe('en'); });
it('shows stale date and entertainment/source notices', async () => { boot({ now: () => Date.parse('2026-10-21T00:00:00Z') }); await vi.waitFor(() => expect(host.textContent).toContain('非今日資料')); expect(host.textContent).toContain('星座運勢僅供娛樂參考'); expect(host.querySelector('a').href).toBe('https://freehoroscopeapi.com/'); });
it('failure retains saved default and storage, and refresh can recover', async () => { localStorage.setItem(HOROSCOPE_KEY, JSON.stringify({ version: 1, defaultSign: 'leo' })); localStorage.setItem('other', 'preserve'); const store = service(); store.load.mockRejectedValueOnce(Error('offline')); boot({ store }); await vi.waitFor(() => expect(host.textContent).toContain('offline')); expect(loadDefaultSign().defaultSign).toBe('leo'); click('重新取得運勢'); await vi.waitFor(() => expect(host.textContent).toContain('Test only leo')); expect(localStorage.getItem('other')).toBe('preserve'); });
it('failed save does not change default and leaving route ignores late requests', async () => { let done; const storage = { getItem: () => null, setItem: () => { throw Error('quota'); } }; boot({ storage, store: { load: () => new Promise(resolve => { done = resolve; }) } }); select('leo'); click('儲存我的星座'); expect(host.textContent).toContain('儲存失敗'); dispose(); const before = host.textContent; done({ data: data(), readAt: Date.now() }); await Promise.resolve(); expect(host.textContent).toBe(before); });

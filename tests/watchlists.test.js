// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { emptyWatchlists, updateWatchlists as update, validateWatchlists, validateGroupName, loadWatchlists, persistWatchlists, sortedStocks, WATCHLIST_KEY } from '../src/services/watchlists.js';
const stock = { code: '2330', name: '台積電', type: 'stock' };
const other = { code: '0050', name: '元大台灣50', type: 'etf' };
const create = (data, name, id) => update(data, { type: 'create', name, id });
const add = (data, s = stock, groupId = data.activeId) => update(data, { type: 'add', stock: s, groupId });
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe('groups and stock membership', () => {
  it('creates immediately, selects and renames while preserving other groups', () => {
    const original = emptyWatchlists(); let data = create(original, ' 科技股 ', 'tech');
    expect(data.activeId).toBe('tech'); expect(data.groups[1].name).toBe('科技股'); expect(original.groups).toHaveLength(1);
    data = update(data, { type: 'rename', name: '長期投資' }); expect(data.groups[1].name).toBe('長期投資');
    data = update(data, { type: 'select', groupId: 'default' }); expect(data.activeId).toBe('default');
  });
  it.each(['', '  ', 'a'.repeat(41), 'test\nname', null, 12])('rejects invalid names %j', value => { expect(() => validateGroupName(value)).toThrow(); });
  it('rejects duplicate names and IDs', () => {
    const data = create(emptyWatchlists(), '科技股', 'tech');
    expect(() => create(data, '科技股', 'other')).toThrow('已存在');
    expect(() => create(data, '金融股', 'tech')).toThrow('重複');
    expect(() => update(data, { type: 'rename', name: '我的自選' })).toThrow('已存在');
  });
  it('does not impose a small group count limit', () => {
    let data = emptyWatchlists(); for (let i = 0; i < 120; i++) data = create(data, `清單 ${i}`, `g-${i}`);
    expect(data.groups).toHaveLength(121);
  });
  it('reorders groups and deletes only the specified group, including the last one', () => {
    let data = create(emptyWatchlists(), '科技股', 'tech'); data = add(data); data = create(data, 'ETF', 'etf'); data = add(data, other);
    data = update(data, { type: 'reorderGroup', groupId: 'etf', direction: -1 });
    expect(data.groups.map(g => g.id)).toEqual(['default', 'etf', 'tech']);
    data = update(data, { type: 'delete', groupId: 'tech' });
    expect(data.groups.find(g => g.id === 'etf').stocks).toEqual([other]); expect(data.activeId).toBe('etf');
    data = update(data, { type: 'delete', groupId: 'etf' }); data = update(data, { type: 'delete', groupId: 'default' });
    expect(data).toMatchObject({ groups: [], activeId: null }); expect(create(data, '新的', 'new').activeId).toBe('new');
  });
  it('prevents duplicates within a group and permits the same code in another', () => {
    let data = add(emptyWatchlists()); expect(() => add(data)).toThrow('已包含');
    data = create(data, '科技股', 'tech'); data = add(data);
    expect(data.groups.every(g => g.stocks.length === 1)).toBe(true);
  });
  it('copies and moves atomically without changing unrelated groups', () => {
    let data = add(emptyWatchlists()); data = create(data, '科技股', 'tech'); data = create(data, 'ETF', 'etf');
    const copy = update(data, { type: 'copy', groupId: 'default', targetId: 'tech', code: '2330' });
    expect(copy.groups[0].stocks).toEqual([stock]); expect(copy.groups[1].stocks).toEqual([stock]);
    expect(() => update(copy, { type: 'move', groupId: 'default', targetId: 'tech', code: '2330' })).toThrow('來源資料未變更');
    expect(copy.groups[0].stocks).toEqual([stock]);
    const moved = update(copy, { type: 'move', groupId: 'tech', targetId: 'etf', code: '2330' });
    expect(moved.groups.map(g => g.stocks.length)).toEqual([1, 0, 1]); expect(copy.groups[1].stocks).toEqual([stock]);
  });
  it('removes only the current membership', () => {
    let data = add(emptyWatchlists()); data = add(create(data, '科技股', 'tech'));
    data = update(data, { type: 'remove', code: '2330' }); expect(data.groups.map(g => g.stocks.length)).toEqual([1, 0]);
  });
  it('sorts by code/name without destroying custom order', () => {
    let data = add(add(emptyWatchlists()), other);
    expect(sortedStocks(data.groups[0], 'code').map(s => s.code)).toEqual(['0050', '2330']);
    expect(sortedStocks(data.groups[0], 'name').map(s => s.name)).toEqual(['台積電', '元大台灣50'].sort((a, b) => a.localeCompare(b, 'zh-Hant')));
    expect(data.groups[0].stocks.map(s => s.code)).toEqual(['2330', '0050']);
    data = update(data, { type: 'reorderStock', code: '0050', direction: -1 });
    expect(data.groups[0].stocks[0].code).toBe('0050');
    data = update(data, { type: 'sort', sort: 'code' }); expect(() => update(data, { type: 'reorderStock', code: '0050', direction: 1 })).toThrow('自訂');
  });
  it('rejects nonexistent groups, stocks, invalid targets and boundary moves', () => {
    const data = add(emptyWatchlists());
    for (const action of [{ type: 'select', groupId: 'missing' }, { type: 'remove', code: '9999' }, { type: 'move', targetId: 'default', code: '2330' }, { type: 'copy', targetId: 'missing', code: '2330' }, { type: 'reorderGroup', direction: -1 }, { type: 'reorderStock', code: '2330', direction: 0 }]) expect(() => update(data, action)).toThrow();
  });
});
describe('safe persistence', () => {
  it('restores group and stock order, names, active group and sort', () => {
    let data = add(add(emptyWatchlists()), other); data = create(data, '科技股', 'tech'); data = add(data);
    data = update(data, { type: 'reorderGroup', direction: -1 }); data = update(data, { type: 'sort', sort: 'name' });
    persistWatchlists(data); expect(loadWatchlists().data).toEqual(data); expect(loadWatchlists().locked).toBe(false);
  });
  it.each(['{bad', 'null', '[]', '{"version":2}', JSON.stringify({ ...emptyWatchlists(), activeId: 'missing' }), JSON.stringify({ ...emptyWatchlists(), groups: [{ id: 'x', name: 'x', stocks: [stock, stock] }] })])('locks corrupt data and preserves its bytes', raw => {
    localStorage.setItem(WATCHLIST_KEY, raw); const result = loadWatchlists();
    expect(result.locked).toBe(true); expect(result.raw).toBe(raw); expect(localStorage.getItem(WATCHLIST_KEY)).toBe(raw);
  });
  it('handles read errors and storage getter denial', () => {
    expect(loadWatchlists({ getItem() { throw Error('denied'); } }).locked).toBe(true);
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => { throw Error('blocked'); });
    expect(loadWatchlists().locked).toBe(true); expect(() => persistWatchlists(emptyWatchlists())).toThrow('權限');
  });
  it('reports quota/write failures without replacing saved data', () => {
    persistWatchlists(emptyWatchlists()); const raw = localStorage.getItem(WATCHLIST_KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(() => persistWatchlists(create(emptyWatchlists(), '新群組', 'new'))).toThrow('容量不足'); expect(localStorage.getItem(WATCHLIST_KEY)).toBe(raw);
  });
  it('strips unknown fields and rejects malformed stock types', () => {
    const data = add(emptyWatchlists(), { ...stock, password: 'not stored', price: 999 });
    expect(validateWatchlists(data).groups[0].stocks[0]).toEqual(stock);
    expect(() => add(data, { ...other, type: ['etf'] })).toThrow('資料無效');
  });
});

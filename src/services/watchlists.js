import { validateStock, validCode } from './stock-catalog.js';

export const WATCHLIST_KEY = 'dailyinfo.watchlists.v1';
export const SORTS = Object.freeze({ custom: '自訂順序', code: '股票代號', name: '股票名稱' });
const validId = id => typeof id === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(id);
export function validateGroupName(value) {
  if (typeof value !== 'string') throw new Error('請輸入群組名稱。');
  const name = value.normalize('NFKC').trim();
  if (!name || Array.from(name).length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('群組名稱需為 1–40 字，且不可包含控制字元。');
  return name;
}
export const emptyWatchlists = () => ({ version: 1, groups: [{ id: 'default', name: '我的自選', stocks: [] }], activeId: 'default', sort: 'custom' });
export function validateWatchlists(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.groups) || typeof data.sort !== 'string' || !Object.hasOwn(SORTS, data.sort)) throw new Error('自選股儲存格式異常。');
  const ids = new Set(), names = new Set();
  const groups = data.groups.map(group => {
    if (!group || !validId(group.id) || ids.has(group.id) || !Array.isArray(group.stocks)) throw new Error('自選群組資料異常。');
    const name = validateGroupName(group.name);
    if (name !== group.name || names.has(name)) throw new Error('自選群組名稱異常。');
    ids.add(group.id); names.add(name);
    const codes = new Set();
    const stocks = group.stocks.map(stock => {
      if (!validateStock(stock) || codes.has(stock.code)) throw new Error('自選股票資料異常。');
      codes.add(stock.code);
      return { code: stock.code, name: stock.name, type: stock.type };
    });
    return { id: group.id, name, stocks };
  });
  if ((groups.length && !ids.has(data.activeId)) || (!groups.length && data.activeId !== null)) throw new Error('上次選擇的群組無效。');
  return { version: 1, groups, activeId: data.activeId, sort: data.sort };
}
export function loadWatchlists(storage) {
  let raw;
  try { storage ??= globalThis.localStorage; raw = storage.getItem(WATCHLIST_KEY); }
  catch { return { data: emptyWatchlists(), problem: '無法讀取瀏覽器儲存空間，請允許本機儲存後重試。', locked: true, raw: null }; }
  if (raw === null) return { data: emptyWatchlists(), problem: '', locked: false, raw: null };
  try { return { data: validateWatchlists(JSON.parse(raw)), problem: '', locked: false, raw }; }
  catch { return { data: { version: 1, groups: [], activeId: null, sort: 'custom' }, problem: '自選股資料損壞；原始內容未變更。可先下載原始備份，再確認重設。', locked: true, raw }; }
}
export function persistWatchlists(data, storage) {
  const clean = validateWatchlists(data);
  try { storage ??= globalThis.localStorage; storage.setItem(WATCHLIST_KEY, JSON.stringify(clean)); }
  catch (error) { throw new Error(error?.name === 'QuotaExceededError' ? '瀏覽器儲存容量不足，本次變更未套用；請先備份並釋放同站儲存空間。' : '無法儲存自選股，本次變更未套用；請檢查瀏覽器儲存權限。'); }
  return clean;
}
function reorder(list, index, direction) {
  if (![-1, 1].includes(direction) || index < 0) throw new Error('排列操作無效。');
  const target = index + direction;
  if (target < 0 || target >= list.length) throw new Error('已到達排列邊界。');
  [list[index], list[target]] = [list[target], list[index]];
}
export function updateWatchlists(data, action) {
  const next = validateWatchlists(data);
  const group = next.groups.find(g => g.id === (action.groupId ?? next.activeId));
  const requireGroup = () => { if (!group) throw new Error('請先建立或選擇群組。'); return group; };
  switch (action.type) {
    case 'create': {
      const name = validateGroupName(action.name);
      if (next.groups.some(g => g.name === name)) throw new Error('群組名稱已存在。');
      const id = action.id ?? crypto.randomUUID();
      if (!validId(id) || next.groups.some(g => g.id === id)) throw new Error('群組識別碼無效或重複。');
      next.groups.push({ id, name, stocks: [] }); next.activeId = id; break;
    }
    case 'rename': {
      requireGroup(); const name = validateGroupName(action.name);
      if (next.groups.some(g => g.id !== group.id && g.name === name)) throw new Error('群組名稱已存在。');
      group.name = name; break;
    }
    case 'select': requireGroup(); next.activeId = group.id; break;
    case 'delete': {
      requireGroup(); const i = next.groups.indexOf(group); next.groups.splice(i, 1);
      if (next.activeId === group.id) next.activeId = next.groups[Math.min(i, next.groups.length - 1)]?.id ?? null;
      break;
    }
    case 'reorderGroup': requireGroup(); reorder(next.groups, next.groups.indexOf(group), action.direction); break;
    case 'sort': if (typeof action.sort !== 'string' || !Object.hasOwn(SORTS, action.sort)) throw new Error('排序方式無效。'); next.sort = action.sort; break;
    case 'add': {
      requireGroup(); if (!validateStock(action.stock)) throw new Error('股票資料無效。');
      if (group.stocks.some(s => s.code === action.stock.code)) throw new Error('此群組已包含這檔股票。');
      group.stocks.push({ code: action.stock.code, name: action.stock.name, type: action.stock.type }); break;
    }
    case 'remove': case 'reorderStock': case 'copy': case 'move': {
      requireGroup(); if (!validCode(action.code)) throw new Error('股票代號無效。');
      const i = group.stocks.findIndex(s => s.code === action.code);
      if (i < 0) throw new Error('群組中找不到這檔股票。');
      if (action.type === 'remove') group.stocks.splice(i, 1);
      else if (action.type === 'reorderStock') {
        if (next.sort !== 'custom') throw new Error('請先切換為自訂順序。');
        reorder(group.stocks, i, action.direction);
      } else {
        const target = next.groups.find(g => g.id === action.targetId);
        if (!target || target.id === group.id) throw new Error('請選擇另一個有效群組。');
        if (target.stocks.some(s => s.code === action.code)) throw new Error('目標群組已包含這檔股票；來源資料未變更。');
        target.stocks.push({ ...group.stocks[i] });
        if (action.type === 'move') group.stocks.splice(i, 1);
      }
      break;
    }
    default: throw new Error('不支援的群組操作。');
  }
  return next;
}
export function sortedStocks(group, sort = 'custom', catalog = new Map()) {
  const stocks = group?.stocks.map(stock => catalog.get(stock.code) ?? stock) ?? [];
  if (sort === 'code') stocks.sort((a, b) => a.code.localeCompare(b.code));
  if (sort === 'name') stocks.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant') || a.code.localeCompare(b.code));
  return stocks;
}

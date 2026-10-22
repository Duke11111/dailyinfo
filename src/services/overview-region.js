import { DEFAULT_REGION, getRegion } from './regions.js';

export const OVERVIEW_REGION_KEY = 'dailyinfo.overview.weather.region.v1';
export function loadOverviewRegion(storage) {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(OVERVIEW_REGION_KEY);
    if (raw === null) return { region: DEFAULT_REGION, saved: false, problem: '' };
    const value = JSON.parse(raw);
    const region = value && !Array.isArray(value) && Object.keys(value).length === 1 && getRegion(value.id);
    if (!region) throw Error('invalid');
    return { region, saved: true, problem: '' };
  } catch {
    return { region: DEFAULT_REGION, saved: false, problem: '無法讀取或驗證首頁常用地區，暫用預設地區；原始設定未被改寫。' };
  }
}
export function saveOverviewRegion(id, storage) {
  const region = getRegion(id);
  if (!region) throw Error('請選擇有效的縣市與鄉鎮市區。');
  try { (storage ?? globalThis.localStorage).setItem(OVERVIEW_REGION_KEY, JSON.stringify({ id: region.id })); }
  catch { throw Error('無法儲存首頁常用地區，原有選擇未變更；請檢查瀏覽器儲存權限或空間。'); }
  return { region, saved: true, problem: '' };
}

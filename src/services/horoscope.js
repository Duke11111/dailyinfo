export const HOROSCOPE_SOURCE = 'https://freehoroscopeapi.com';
export const HOROSCOPE_KEY = 'dailyinfo.horoscope.v1';
export const SIGNS = Object.freeze([
  ['aries', '牡羊座', '♈'], ['taurus', '金牛座', '♉'], ['gemini', '雙子座', '♊'],
  ['cancer', '巨蟹座', '♋'], ['leo', '獅子座', '♌'], ['virgo', '處女座', '♍'],
  ['libra', '天秤座', '♎'], ['scorpio', '天蠍座', '♏'], ['sagittarius', '射手座', '♐'],
  ['capricorn', '摩羯座', '♑'], ['aquarius', '水瓶座', '♒'], ['pisces', '雙魚座', '♓'],
].map(([code, name, symbol]) => Object.freeze({ code, name, symbol })));
export const validSign = sign => typeof sign === 'string' && SIGNS.some(item => item.code === sign);
export const readingUrl = sign => { if (!validSign(sign)) throw Error('無效星座代碼'); return `${HOROSCOPE_SOURCE}/api/v1/get-horoscope/daily?sign=${sign}`; };
export function taipeiDate(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}
function validDate(date) { return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date; }
export function parseReading(raw, sign) {
  const data = raw?.data;
  if (!validSign(sign) || typeof data?.sign !== 'string' || data.sign.toLowerCase() !== sign || data.period !== 'daily' || !validDate(data.date) || typeof data.horoscope !== 'string' || !data.horoscope.trim() || data.horoscope.length > 20000) throw Error('運勢資料格式異常');
  return { sign, date: data.date, text: data.horoscope.trim() }; // No invented ratings or categories.
}
export function validateHoroscope(raw) {
  if (raw?.version !== 1 || raw.source !== HOROSCOPE_SOURCE || raw.language !== 'en' || typeof raw.fetchedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(raw.fetchedAt) || !Number.isFinite(Date.parse(raw.fetchedAt)) || !Array.isArray(raw.readings) || raw.readings.length !== 12) throw Error('運勢快照格式異常');
  const readings = SIGNS.map(({ code }) => {
    const matches = raw.readings.filter(item => item?.sign === code);
    if (matches.length !== 1) throw Error('十二星座資料不完整或重複');
    const item = matches[0];
    return parseReading({ data: { sign: code, date: item.date, period: 'daily', horoscope: item.text } }, code);
  });
  if (new Set(readings.map(item => item.date)).size !== 1) throw Error('星座來源日期不一致');
  return { version: 1, source: HOROSCOPE_SOURCE, language: 'en', fetchedAt: raw.fetchedAt, readings };
}
export function loadDefaultSign(storage) {
  try {
    storage ??= globalThis.localStorage;
    const value = storage.getItem(HOROSCOPE_KEY);
    if (value === null) return { defaultSign: null, problem: '' };
    const data = JSON.parse(value);
    if (data?.version !== 1 || !validSign(data.defaultSign)) throw Error();
    return { defaultSign: data.defaultSign, problem: '' };
  } catch { return { defaultSign: null, problem: '星座設定無法讀取，原始資料未變更。' }; }
}
export function saveDefaultSign(sign, storage) {
  if (!validSign(sign)) throw Error('請選擇有效星座');
  try { (storage ?? globalThis.localStorage).setItem(HOROSCOPE_KEY, JSON.stringify({ version: 1, defaultSign: sign })); }
  catch { throw Error('星座設定儲存失敗，請檢查瀏覽器儲存空間或權限。'); }
}
export function createHoroscopeStore({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let cached, pending;
  return { async load() {
    if (cached && now() - cached.readAt < 300000) return cached;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetchImpl(`${import.meta.env?.BASE_URL ?? '/'}data/horoscope.json`, { signal: AbortSignal.timeout(12000), cache: 'no-cache' });
      if (!response.ok) throw Error('尚無可用運勢快照，請由維護者執行 update:horoscope。');
      const data = validateHoroscope(await response.json());
      cached = { data, readAt: now() }; return cached;
    })();
    try { return await pending; } finally { pending = null; }
  } };
}
export const horoscopeStore = createHoroscopeStore();

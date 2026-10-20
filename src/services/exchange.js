export const EXCHANGE_SOURCE = 'https://rate.bot.com.tw/xrt?Lang=zh-TW';
export const EXCHANGE_CSV = 'https://rate.bot.com.tw/xrt/flcsv/0/day';
export const EXCHANGE_LICENSE = 'https://data.gov.tw/license';
export const EXCHANGE_POLICY = 'https://www.bot.com.tw/tw/footer/related-links/open-data-statement';
export const CURRENCY_NAMES = Object.freeze({ USD: '美元', JPY: '日圓', EUR: '歐元', GBP: '英鎊', HKD: '港幣', CNY: '人民幣', KRW: '韓元', AUD: '澳幣', CAD: '加拿大幣', SGD: '新加坡幣', CHF: '瑞士法郎', ZAR: '南非幣', SEK: '瑞典幣', NZD: '紐元', THB: '泰幣', PHP: '菲國比索', IDR: '印尼幣', VND: '越南盾', MYR: '馬來幣' });
export const COMMON_CURRENCIES = Object.freeze(['USD', 'JPY', 'EUR', 'GBP', 'HKD', 'CNY', 'KRW', 'AUD']);
const validRate = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000000 && /^\d+(?:\.\d{1,5})?$/.test(String(value)));
export function exchangeTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value) + 28800000).toISOString().slice(0, 16) !== value.slice(0, 16)) throw Error('銀行牌告時間無效。');
  return value;
}
export function validateExchangeSnapshot(raw) {
  if (!raw || raw.version !== 1 || raw.source !== '臺灣銀行' || raw.sourceUrl !== EXCHANGE_SOURCE || raw.downloadUrl !== EXCHANGE_CSV || raw.licenseUrl !== EXCHANGE_LICENSE || raw.base !== 'TWD' || raw.unit !== 1 || !Array.isArray(raw.rates) || !raw.rates.length || raw.rates.length > 100) throw Error('匯率快照格式或來源異常。');
  const quotedAt = exchangeTime(raw.quotedAt);
  if (typeof raw.fetchedAt !== 'string' || !Number.isFinite(Date.parse(raw.fetchedAt)) || new Date(raw.fetchedAt).toISOString() !== raw.fetchedAt || Date.parse(quotedAt) > Date.parse(raw.fetchedAt) + 60000) throw Error('匯率快照時間異常。');
  const seen = new Set();
  const rates = raw.rates.map(rate => {
    if (!rate || !Object.hasOwn(CURRENCY_NAMES, rate.code) || seen.has(rate.code) || typeof rate.name !== 'string' || !rate.name.trim() || rate.name.length > 40 || /[\u0000-\u001f\u007f]/.test(rate.name)) throw Error('幣別資料異常。');
    seen.add(rate.code); const clean = { code: rate.code, name: rate.name };
    for (const mode of ['cash', 'spot']) {
      const pair = rate[mode];
      if (!pair || !Object.hasOwn(pair, 'buy') || !Object.hasOwn(pair, 'sell') || !validRate(pair.buy) || !validRate(pair.sell) || (pair.buy !== null && pair.sell !== null && pair.buy > pair.sell)) throw Error('銀行買賣匯率異常。');
      clean[mode] = { buy: pair.buy, sell: pair.sell };
    }
    if (['cash', 'spot'].every(mode => clean[mode].buy === null && clean[mode].sell === null)) throw Error('幣別沒有有效報價。');
    return clean;
  });
  let evidence = raw.evidence && ['csvSha256', 'htmlSha256'].every(key => /^[a-f0-9]{64}$/.test(raw.evidence[key])) ? { csvSha256: raw.evidence.csvSha256, htmlSha256: raw.evidence.htmlSha256 } : null;
  if (raw.evidence?.mode === 'html-only') {
    if (Object.keys(raw.evidence).sort().join(',') !== 'htmlSha256,mode,reason,validation' || raw.evidence.reason !== 'csv_text_html'
      || raw.evidence.validation !== 'official-table-19-v1' || !/^[a-f0-9]{64}$/.test(raw.evidence.htmlSha256) || rates.length !== Object.keys(CURRENCY_NAMES).length) throw Error('HTML 備援證據無效。');
    evidence = { mode: 'html-only', reason: 'csv_text_html', validation: 'official-table-19-v1', htmlSha256: raw.evidence.htmlSha256 };
  }
  return { version: 1, source: '臺灣銀行', sourceUrl: EXCHANGE_SOURCE, downloadUrl: EXCHANGE_CSV, licenseUrl: EXCHANGE_LICENSE, base: 'TWD', unit: 1, quotedAt, fetchedAt: raw.fetchedAt, rates, evidence };
}
export function filterCurrencies(rates, query = '') {
  if (typeof query !== 'string' || query.length > 80) throw Error('幣別搜尋條件無效。');
  const text = query.normalize('NFKC').replace(/台/g, '臺').toLowerCase().trim();
  return rates.filter(rate => `${rate.code} ${rate.name} ${CURRENCY_NAMES[rate.code]}`.toLowerCase().includes(text));
}
const fixed = (value, digits) => { const [whole = '0', fraction = ''] = value.split('.'); return BigInt(whole || '0') * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0')); };
const decimal = value => `${value / 1000000n}.${String(value % 1000000n).padStart(6, '0')}`;
export function convertExchange(amount, rate, mode, direction) {
  if (typeof amount !== 'string' || amount.length > 30 || !/^(?:\d+(?:\.\d{0,6})?|\.\d{1,6})$/.test(amount.trim())) throw Error('請輸入非負數金額，最多六位小數；不接受逗號或指數格式。');
  const input = fixed(amount.trim(), 6);
  if (input > 1000000000000000000n) throw Error('金額上限為 1 兆，請縮小金額。');
  if (!['cash', 'spot'].includes(mode) || !['toForeign', 'toTwd'].includes(direction) || !rate || !Object.hasOwn(CURRENCY_NAMES, rate.code)) throw Error('換算方向或幣別無效。');
  const side = direction === 'toTwd' ? 'buy' : 'sell', price = rate[mode]?.[side];
  if (!validRate(price) || price === null) throw Error('此幣別未提供所選類型與方向的匯率，無法換算。');
  const priceUnits = fixed(String(price), 5);
  const numerator = direction === 'toTwd' ? input * priceUnits : input * 100000n, denominator = direction === 'toTwd' ? 100000n : priceUnits;
  const result = (numerator + denominator / 2n) / denominator;
  return { value: decimal(result), amount: decimal(input), rate: price, side, operator: direction === 'toTwd' ? '×' : '÷', from: direction === 'toTwd' ? rate.code : 'TWD', to: direction === 'toTwd' ? 'TWD' : rate.code };
}
export const exchangeNumber = value => Number.isFinite(value) ? new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 5 }).format(value) : '未提供';
export function exchangeAmount(value) {
  const [whole, fraction = ''] = value.split('.'); return `${BigInt(whole).toLocaleString('zh-TW')}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`;
}
export const isExchangeStale = (snapshot, now = Date.now()) => now - Date.parse(snapshot.quotedAt) > 86400000 || now - Date.parse(snapshot.fetchedAt) > 86400000;
export async function fetchExchangeSnapshot({ fetchImpl = (...args) => fetch(...args), timeout = 12000 } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(`${import.meta.env?.BASE_URL ?? '/'}data/exchange.json`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw Error(`匯率快照讀取失敗（HTTP ${response.status}）。`);
    return validateExchangeSnapshot(await response.json());
  } catch (error) { throw Error(error.name === 'AbortError' ? '匯率快照讀取逾時。' : error instanceof SyntaxError ? '匯率快照不是有效 JSON。' : error.message || '匯率讀取失敗。'); }
  finally { clearTimeout(timer); }
}
export function createExchangeStore({ fetcher = fetchExchangeSnapshot, now = Date.now } = {}) {
  let data = null, readAt = 0, attemptedAt = -Infinity, pending = null;
  return {
    peek: () => data,
    load({ force = false } = {}) {
      if (pending) return pending;
      if (data && ((!force && now() - readAt < 300000) || now() - attemptedAt < 10000)) return Promise.resolve({ data, readAt, cached: true });
      if (!data && now() - attemptedAt < 10000) return Promise.reject(Error('請稍候 10 秒再讀取匯率快照。'));
      attemptedAt = now(); pending = Promise.resolve().then(fetcher).then(next => {
        if (data && (next.quotedAt < data.quotedAt || next.fetchedAt < data.fetchedAt)) throw Error('網站回傳較舊匯率快照，已保留有效資料。');
        data = next; readAt = now(); return { data, readAt, cached: false };
      }).finally(() => { pending = null; }); return pending;
    },
  };
}
export const exchangeStore = createExchangeStore();

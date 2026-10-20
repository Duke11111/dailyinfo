// Frozen v1 archive validation only. No requests, updater, or frontend imports.
const EXCHANGE_SOURCE = 'https://rate.bot.com.tw/xrt?Lang=zh-TW';
const EXCHANGE_CSV = 'https://rate.bot.com.tw/xrt/flcsv/0/day';
const EXCHANGE_CLOSE_LEGACY = 'https://rate.bot.com.tw/xrt/all/day';
const EXCHANGE_CLOSE = `${EXCHANGE_CLOSE_LEGACY}?Lang=zh-TW`;
const closeDownloadUrl = date => `https://rate.bot.com.tw/xrt/fltxt/0/${date}`;
const EXCHANGE_LICENSE = 'https://data.gov.tw/license';
const CURRENCY_NAMES = Object.freeze({ USD: '美元', JPY: '日圓', EUR: '歐元', GBP: '英鎊', HKD: '港幣', CNY: '人民幣', KRW: '韓元', AUD: '澳幣', CAD: '加拿大幣', SGD: '新加坡幣', CHF: '瑞士法郎', ZAR: '南非幣', SEK: '瑞典幣', NZD: '紐元', THB: '泰幣', PHP: '菲國比索', IDR: '印尼幣', VND: '越南盾', MYR: '馬來幣' });
const validRate = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000000 && /^\d+(?:\.\d{1,5})?$/.test(String(value)));
function exchangeTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value) + 28800000).toISOString().slice(0, 16) !== value.slice(0, 16)) throw Error('銀行牌告時間無效。');
  return value;
}
export function validateLegacySnapshot(raw, now = Date.now()) {
  const dailyClose = raw?.mode === 'daily-close';
  if (!raw || raw.mode !== undefined && !dailyClose || raw.version !== 1 || raw.source !== '臺灣銀行'
    || (dailyClose ? ![EXCHANGE_CLOSE, EXCHANGE_CLOSE_LEGACY].includes(raw.sourceUrl) : raw.sourceUrl !== EXCHANGE_SOURCE) || raw.downloadUrl !== (dailyClose ? closeDownloadUrl(raw.dataDate) : EXCHANGE_CSV)
    || raw.licenseUrl !== EXCHANGE_LICENSE || raw.base !== 'TWD' || raw.unit !== 1 || !Array.isArray(raw.rates) || !raw.rates.length || raw.rates.length > 100) throw Error('匯率快照格式或來源異常。');
  const quotedAt = exchangeTime(raw.quotedAt);
  if (dailyClose && (raw.dataDate !== quotedAt.slice(0, 10) || raw.rates.length !== Object.keys(CURRENCY_NAMES).length)) throw Error('收盤匯率日期或幣別不完整。');
  if (typeof raw.fetchedAt !== 'string' || !Number.isFinite(Date.parse(raw.fetchedAt)) || new Date(raw.fetchedAt).toISOString() !== raw.fetchedAt || Date.parse(quotedAt) > Date.parse(raw.fetchedAt) + 60000) throw Error('匯率快照時間異常。');
  if (Date.parse(raw.fetchedAt) > now + 300000 || raw.rates.length !== 19) throw Error('Legacy snapshot invalid');
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
  if (dailyClose) {
    const proof = raw.evidence;
    if (!proof || Object.keys(proof).sort().join(',') !== 'htmlSha256,mode,txtSha256,validation' || proof.mode !== 'html-txt'
      || proof.validation !== 'daily-close-19-v1' || !['htmlSha256', 'txtSha256'].every(key => /^[a-f0-9]{64}$/.test(proof[key]))) throw Error('收盤匯率核對證據無效。');
    evidence = { mode: 'html-txt', validation: 'daily-close-19-v1', htmlSha256: proof.htmlSha256, txtSha256: proof.txtSha256 };
  }
  return { version: 1, ...(dailyClose ? { mode: 'daily-close', dataDate: raw.dataDate } : {}), source: '臺灣銀行', sourceUrl: raw.sourceUrl, downloadUrl: raw.downloadUrl, licenseUrl: EXCHANGE_LICENSE, base: 'TWD', unit: 1, quotedAt, fetchedAt: raw.fetchedAt, rates, evidence };
}

// Frozen allowlist for validation of archived v1 status records only.
const EXCHANGE_MIME_CLASSES = Object.freeze(['text/plain', 'text/html', 'text/csv', 'application/octet-stream', 'application/json', 'missing', 'other']);
const mimeCode = (endpoint, mime) => `unexpected_content_type_${endpoint}_${mime.replace(/[\/-]/g, '_')}`;
const EXCHANGE_ERROR_CODES = Object.freeze([
  'network_error', 'dns_error', 'tls_error', 'connection_error', 'request_timeout',
  'http_403', 'http_429', 'http_5xx', 'http_error', 'redirect_error',
  'unexpected_content_type', 'encoding_error', 'response_too_large',
  'csv_format_error', 'quote_time_error', 'csv_html_mismatch', 'parse_error',
  'date_regression', 'previous_snapshot_invalid', 'filesystem_error', 'update_failed',
  // Preserve the historical fixed diagnostic names.
  ...['csv', 'html'].flatMap(endpoint => EXCHANGE_MIME_CLASSES.map(mime => mimeCode(endpoint, mime))),
]);

export function stripLegacyState(raw, now = Date.now()) {
  if (raw?.version !== 1 || !raw.sources || typeof raw.sources !== 'object' || Array.isArray(raw.sources)) throw Error('Legacy state invalid');
  const record = raw.sources.exchange;
  const iso = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x));
  if (record && (!iso(record.attemptedAt) || Date.parse(record.attemptedAt) > now + 300000 || !['updated','unchanged','failed'].includes(record.status)
    || !['ok','update_failed','validation_failed'].includes(record.code) && !(record.status === 'failed' && EXCHANGE_ERROR_CODES.includes(record.code))
    || record.lastSuccessAt != null && (!iso(record.lastSuccessAt) || Date.parse(record.lastSuccessAt) > Date.parse(record.attemptedAt)))) throw Error('Legacy state invalid');
  if (Object.hasOwn(raw.sources, 'exchange') && !record) throw Error('Legacy state invalid');
  const sources = { ...raw.sources }; delete sources.exchange;
  return { version: 1, sources };
}

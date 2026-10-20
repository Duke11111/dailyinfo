export const EQ_SOURCE = '中央氣象署';
export const EQ_TYPES = Object.freeze({ 'E-A0015-001': '顯著有感', 'E-A0016-001': '小區域有感' });
export const EQ_SOURCE_URL = 'https://opendata.cwa.gov.tw/';
const ranks = ['0級', '1級', '2級', '3級', '4級', '5級', '5弱', '5強', '6級', '6弱', '6強', '7級'];
const blank = value => value === undefined || value === null || value === '' || value === '--';
function text(value, max = 300, optional = false) {
  if (optional && blank(value)) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('地震文字資料異常。');
  return value.trim();
}
export function quakeNumber(value, min, max, optional = true) {
  if (optional && blank(value)) return null;
  if (!(typeof value === 'number' || typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value))) throw new Error('地震數值格式異常。');
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error('地震數值超出有效範圍。');
  return number;
}
export function quakeTime(raw, optional = false) {
  if (optional && blank(raw)) return null;
  if (typeof raw !== 'string') throw new Error('地震時間格式異常。');
  let value = raw.replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+08:00)?$/.test(value)) throw new Error('地震時間格式異常。');
  if (!/(Z|\+08:00)$/.test(value)) value += '+08:00';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('地震時間無效。');
  const local = new Date(timestamp + (value.endsWith('Z') ? 0 : 28800000)).toISOString();
  if (local.slice(0, 19) !== value.slice(0, 19) || value < '2000') throw new Error('地震時間無效。');
  return new Date(timestamp).toISOString();
}
export const quakeDay = time => new Date(Date.parse(time) + 28800000).toISOString().slice(0, 10);
export function quakeReportUrl(raw) {
  if (blank(raw)) return null;
  if (typeof raw !== 'string') throw new Error('地震報告連結異常。');
  const url = new URL(raw);
  const official = url.hostname === 'www.cwa.gov.tw' && /^\/V8\/C\/E\/EQ\/[A-Za-z0-9_-]+\.html$/.test(url.pathname) || url.hostname === 'scweb.cwa.gov.tw' && /^\/zh-tw\/earthquake\/details\/[A-Za-z0-9_-]+$/.test(url.pathname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !official) throw new Error('地震報告連結不在官方允許範圍。');
  return url.href;
}
export function quakeIntensity(raw) {
  if (blank(raw)) return null;
  let value = String(raw).trim(); if (/^[0-7]$/.test(value)) value += '級';
  if (!ranks.includes(value)) throw new Error('觀測震度格式異常。');
  return value;
}
const maximum = values => values.filter(Boolean).sort((a, b) => ranks.indexOf(b) - ranks.indexOf(a))[0] ?? null;
const identity = event => `${event.originTime}_${event.latitude.toFixed(3)}_${event.longitude.toFixed(3)}`;
function observedAreas(raw) {
  if (raw === undefined || raw === null) return { areas: [], maxIntensity: null };
  const list = raw.ShakingArea;
  if (!Array.isArray(list)) throw new Error('地震觀測資料格式異常。');
  const counties = new Map(), intensities = [];
  for (const area of list) {
    if (!area || typeof area !== 'object') throw new Error('地震觀測區域異常。');
    if (area.InfoStatus && area.InfoStatus !== 'observe') continue;
    const intensity = quakeIntensity(area.AreaIntensity); intensities.push(intensity);
    const countyRaw = area.CountyName ?? area.AreaDesc?.replace(/地區$/, '');
    if (countyRaw) {
      // New reports may group several counties in one CountyName field.
      const names = text(countyRaw).replaceAll('台', '臺').match(/臺北市|新北市|桃園市|臺中市|臺南市|高雄市|基隆市|新竹[縣市]|嘉義[縣市]|宜蘭縣|苗栗縣|彰化縣|南投縣|雲林縣|屏東縣|花蓮縣|臺東縣|澎湖縣|金門縣|連江縣/g) ?? [];
      for (const county of names) counties.set(county, maximum([counties.get(county), intensity]));
    }
    if (area.EqStation !== undefined) {
      if (!Array.isArray(area.EqStation)) throw new Error('地震測站資料異常。');
      for (const station of area.EqStation) if (!station.InfoStatus || station.InfoStatus === 'observe') intensities.push(quakeIntensity(station.SeismicIntensity));
    }
  }
  return { areas: [...counties].map(([county, intensity]) => ({ county, intensity })), maxIntensity: maximum(intensities) };
}
export function parseEarthquakeResponse(data, dataset, fetchedAt) {
  if (!Object.hasOwn(EQ_TYPES, dataset) || !['true', true].includes(data?.success) || !Array.isArray(data.records?.Earthquake)) throw new Error('地震 API 格式或資料集異常。');
  const captured = quakeTime(fetchedAt);
  return data.records.Earthquake.map(raw => {
    const info = raw?.EarthquakeInfo, center = info?.Epicenter;
    if (!info || !center) throw new Error('地震缺少震源資料。');
    const originTime = quakeTime(info.OriginTime), reportTime = quakeTime(raw.IssueTime ?? raw.ReportDateTime ?? raw.ReportTime, true);
    if (Date.parse(originTime) > Date.parse(captured) + 300000 || reportTime && (Date.parse(reportTime) > Date.parse(captured) + 300000 || reportTime < originTime)) throw new Error('地震發生或報告時間異常。');
    const event = { originTime, reportTime, latitude: quakeNumber(center.EpicenterLatitude, -90, 90, false), longitude: quakeNumber(center.EpicenterLongitude, -180, 180, false),
      location: text(center.Location), magnitude: quakeNumber(info.EarthquakeMagnitude?.MagnitudeValue, 0, 10), magnitudeType: text(info.EarthquakeMagnitude?.MagnitudeType, 40, true), depth: quakeNumber(info.FocalDepth, 0, 800), ...observedAreas(raw.Intensity),
      reports: [{ dataset, number: quakeNumber(raw.EarthquakeNo, 0, 999999999), url: quakeReportUrl(raw.Web), issuedAt: reportTime }] };
    return { id: identity(event), ...event };
  });
}
export function mergeEarthquakes(batches) {
  const merged = [];
  for (const event of batches.flat()) {
    // Conservative duplicate match: same origin second, epicenter within 0.03 degrees.
    const index = merged.findIndex(previous => previous.originTime === event.originTime && Math.abs(previous.latitude - event.latitude) <= .03 && Math.abs(previous.longitude - event.longitude) <= .03);
    if (index < 0) { merged.push(event); continue; }
    const previous = merged[index];
    const preferred = (event.reportTime ?? '') > (previous.reportTime ?? '') ? event : (event.reportTime ?? '') < (previous.reportTime ?? '') ? previous : event.reports[0].dataset === 'E-A0015-001' ? event : previous;
    const reports = [...previous.reports, ...event.reports].filter((report, i, all) => all.findIndex(r => r.dataset === report.dataset && r.number === report.number && r.url === report.url && r.issuedAt === report.issuedAt) === i);
    merged[index] = { ...preferred, reports };
  }
  return merged.sort((a, b) => b.originTime.localeCompare(a.originTime) || a.id.localeCompare(b.id));
}
export function validateEarthquakeSnapshot(data) {
  if (!data || data.version !== 1 || data.source !== EQ_SOURCE || data.sourceUrl !== EQ_SOURCE_URL || !Array.isArray(data.feeds) || data.feeds.length !== 2 || !Array.isArray(data.events)) throw new Error('地震快照格式異常。');
  const fetchedAt = quakeTime(data.fetchedAt), datasets = new Set(), ids = new Set();
  const feeds = data.feeds.map(feed => {
    if (!feed || !Object.hasOwn(EQ_TYPES, feed.dataset) || datasets.has(feed.dataset) || !Number.isSafeInteger(feed.count) || feed.count < 0) throw new Error('地震來源紀錄異常。');
    datasets.add(feed.dataset); const time = quakeTime(feed.fetchedAt); if (time > fetchedAt) throw new Error('地震擷取時間異常。');
    return { dataset: feed.dataset, count: feed.count, fetchedAt: time };
  });
  const events = data.events.map(event => {
    if (!event || !Array.isArray(event.areas) || !Array.isArray(event.reports) || !event.reports.length) throw new Error('地震事件欄位異常。');
    const originTime = quakeTime(event.originTime), reportTime = quakeTime(event.reportTime, true), counties = new Set();
    const safe = { originTime, reportTime, location: text(event.location), latitude: quakeNumber(event.latitude, -90, 90, false), longitude: quakeNumber(event.longitude, -180, 180, false), magnitude: quakeNumber(event.magnitude, 0, 10), magnitudeType: text(event.magnitudeType, 40, true), depth: quakeNumber(event.depth, 0, 800), maxIntensity: quakeIntensity(event.maxIntensity),
      areas: event.areas.map(area => { const county = text(area.county, 30); if (counties.has(county)) throw new Error('重複縣市觀測資料。'); counties.add(county); return { county, intensity: quakeIntensity(area.intensity) }; }),
      reports: event.reports.map(report => {
        if (!Object.hasOwn(EQ_TYPES, report.dataset)) throw new Error('未知地震報告來源。');
        const number = quakeNumber(report.number, 0, 999999999), issuedAt = quakeTime(report.issuedAt, true);
        if (number !== null && !Number.isSafeInteger(number) || issuedAt && (issuedAt < originTime || Date.parse(issuedAt) > Date.parse(fetchedAt) + 300000)) throw new Error('地震報告編號或發布時間異常。');
        return { dataset: report.dataset, number, url: quakeReportUrl(report.url), issuedAt };
      }) };
    if (event.id !== identity(safe) || ids.has(event.id) || Date.parse(originTime) > Date.parse(fetchedAt) + 300000 || reportTime && (reportTime < originTime || Date.parse(reportTime) > Date.parse(fetchedAt) + 300000)) throw new Error('地震識別碼或時間異常。');
    if (maximum(safe.areas.map(a => a.intensity)) && (!safe.maxIntensity || ranks.indexOf(safe.maxIntensity) < ranks.indexOf(maximum(safe.areas.map(a => a.intensity)))) ) throw new Error('最大觀測震度矛盾。');
    ids.add(event.id); return { id: event.id, ...safe };
  });
  if (feeds.reduce((sum, feed) => sum + feed.count, 0) < events.length) throw new Error('地震來源數量與事件數量不一致。');
  return { version: 1, source: EQ_SOURCE, sourceUrl: EQ_SOURCE_URL, fetchedAt, feeds, events: events.sort((a, b) => b.originTime.localeCompare(a.originTime) || a.id.localeCompare(b.id)) };
}
export function filterEarthquakes(events, filters = {}) {
  const { query = '', type = 'all', minMagnitude = '', maxMagnitude = '', startDate = '', endDate = '' } = filters;
  if (type !== 'all' && !Object.hasOwn(EQ_TYPES, type)) throw new Error('請選擇有效地震分類。');
  const min = quakeNumber(minMagnitude, 0, 10), max = quakeNumber(maxMagnitude, 0, 10);
  if (min !== null && max !== null && min > max) throw new Error('最小規模不可大於最大規模。');
  for (const date of [startDate, endDate]) if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || quakeTime(`${date}T00:00:00+08:00`) === null)) throw new Error('請輸入有效日期。');
  if (startDate && endDate && startDate > endDate) throw new Error('開始日期不可晚於結束日期。');
  const normalize = value => value.normalize('NFKC').replaceAll('台', '臺').toLowerCase();
  const terms = normalize(String(query)).trim().split(/\s+/).filter(Boolean);
  return events.filter(event => terms.every(term => normalize(`${event.location} ${event.areas.map(a => a.county).join(' ')}`).includes(term)) && (type === 'all' || event.reports.some(report => report.dataset === type)) && (min === null || event.magnitude !== null && event.magnitude >= min) && (max === null || event.magnitude !== null && event.magnitude <= max) && (!startDate || quakeDay(event.originTime) >= startDate) && (!endDate || quakeDay(event.originTime) <= endDate))
    .sort((a, b) => b.originTime.localeCompare(a.originTime));
}
export async function fetchEarthquakeSnapshot({ fetchImpl = (...args) => fetch(...args), timeout = 12000 } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(`${import.meta.env?.BASE_URL ?? '/'}data/earthquakes.json`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`地震快照讀取失敗（HTTP ${response.status}）。`);
    return validateEarthquakeSnapshot(await response.json());
  } catch (error) { throw new Error(error.name === 'AbortError' ? '地震資料讀取逾時。' : error.message || '地震資料讀取失敗。'); }
  finally { clearTimeout(timer); }
}
export function createEarthquakeStore({ fetcher = fetchEarthquakeSnapshot, now = Date.now } = {}) {
  let data = null, readAt = 0, attemptedAt = -Infinity, pending = null;
  return { peek: () => data, load({ force = false } = {}) {
    if (pending) return pending;
    if (data && ((!force && now() - readAt < 300000) || now() - attemptedAt < 10000)) return Promise.resolve({ data, readAt, cached: true });
    if (!data && now() - attemptedAt < 10000) return Promise.reject(new Error('請稍候 10 秒再讀取地震快照。'));
    attemptedAt = now();
    pending = Promise.resolve().then(fetcher).then(next => { if (data && next.fetchedAt < data.fetchedAt) throw new Error('拒絕較舊快照，已保留原有資料。'); data = next; readAt = now(); return { data, readAt, cached: false }; }).finally(() => { pending = null; });
    return pending;
  } };
}
export const earthquakeStore = createEarthquakeStore();

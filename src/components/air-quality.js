import { isoInstant, nowMs } from '../lib/time.js';
import { classifyUsAqi, AIR_SOURCE } from '../services/air-quality.js';
import { regionLabel, validateCoordinates } from '../services/regions.js';
import { escapeHtml as esc } from '../lib/html.js';
import { formatTime } from '../lib/format.js';

const number = value => Number.isFinite(value) ? new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(value) : '未提供';
function trend(points) {
  const valid = points.filter(point => Number.isFinite(point.aqi));
  if (!valid.length) return '<p class="air-note">沒有可繪製的逐時 AQI；未使用模擬值。</p>';
  const start = Date.parse(points[0].time), span = Math.max(3600000, Date.parse(points.at(-1).time) - start);
  const high = Math.max(50, ...valid.map(point => point.aqi));
  const x = point => 48 + (Date.parse(point.time) - start) / span * 590;
  const y = point => 160 - point.aqi / high * 130;
  const coords = point => `${x(point).toFixed(2)},${y(point).toFixed(2)}`;
  let segment = [], previous = null; const segments = [];
  for (const point of points) {
    if (!Number.isFinite(point.aqi) || (previous && Date.parse(point.time) - Date.parse(previous.time) !== 3600000)) { if (segment.length) segments.push(segment); segment = []; }
    if (Number.isFinite(point.aqi)) segment.push(point);
    previous = point;
  }
  if (segment.length) segments.push(segment);
  return `<div class="air-chart-wrap"><svg class="air-chart" viewBox="0 0 680 200" role="img" aria-label="來源提供的逐時美國 AQI 預報，缺值處斷線"><title>逐時 US AQI 模式預報</title><line x1="48" x2="638" y1="160" y2="160" class="air-axis"/><text x="40" y="164" text-anchor="end">0</text><text x="40" y="34" text-anchor="end">${number(high)}</text>${segments.map(part => `<polyline points="${part.map(coords).join(' ')}"/>`).join('')}${valid.map(point => `<circle cx="${x(point).toFixed(2)}" cy="${y(point).toFixed(2)}" r="3"><title>${esc(formatTime(point.time))} · US AQI ${number(point.aqi)}</title></circle>`).join('')}<text x="48" y="187">${esc(formatTime(points[0].time))}</text><text x="638" y="187" text-anchor="end">${esc(formatTime(points.at(-1).time))}</text></svg></div>
    <details class="air-values"><summary>查看實際預報時間與數值（${points.length} 筆／${valid.length} 筆有效）</summary><ul>${points.map(point => `<li>${esc(formatTime(point.time))} · US AQI ${number(point.aqi)}</li>`).join('')}</ul></details>`;
}
export function renderAirQuality(state, { compact = false, now = nowMs() } = {}) {
  const data = state?.data, category = classifyUsAqi(data?.aqi), loading = state?.status === 'loading';
  const label = validateCoordinates(state?.region) ? regionLabel(state.region) : '地區未選定';
  const old = data && now - Date.parse(data.time) > 6 * 3600000;
  const expired = data && Number.isFinite(state.expiresAt) && now >= state.expiresAt;
  const heading = compact ? 'h3' : 'h2';
  return `<section class="${compact ? 'air-quality air-compact' : 'card air-quality'}" aria-label="${compact ? '空氣品質摘要' : '空氣品質'}" aria-busy="${loading}">
    <div class="air-heading"><${heading}>${compact ? '空氣品質摘要' : '空氣品質'}</${heading}><span class="air-note">${esc(label)}</span></div>
    <p class="air-note">Open-Meteo／CAMS 空氣品質模式估計／預報，非臺灣環境部測站實測值。</p>
    ${loading ? '<p role="status" class="air-note">正在查詢空氣品質…</p>' : ''}
    ${state?.status === 'error' ? `<p role="alert" class="air-error">${esc(state.error?.message || '空氣品質查詢失敗。')}${data ? ' 保留此地區先前資料，並非本次新取得。' : ''}</p>` : ''}
    ${old || expired ? `<p class="air-error">${old ? '模式有效時間距今超過 6 小時，請留意時效。' : ''}${expired ? '本機快取已過期，請重新查詢。' : ''}</p>` : ''}
    ${data ? `<div class="air-metrics"><div class="air-index air-${category.key}"><span>美國 AQI（US AQI）</span><strong>${number(data.aqi)}</strong><b>${category.label}</b></div><div><span>PM2.5</span><strong>${number(data.pm25)} <small>µg/m³</small></strong></div>${compact ? '' : `<div><span>PM10</span><strong>${number(data.pm10)} <small>µg/m³</small></strong></div>`}</div>
      ${compact ? '' : `<p class="air-note">${category.description}</p>`}
      ${data.warnings.length ? `<p class="air-note">${esc(data.warnings.join('；'))}</p>` : ''}
      ${compact ? '' : `<h3>有效時段起 24 小時 US AQI 預報</h3><p class="air-note">顯示 API 提供的逐時預報，非歷史實測；缺值／缺時段不補值、不連線。</p>${trend(data.points)}`}
      <p class="air-note air-times">有效時間：${esc(formatTime(data.time))} · API 擷取：${esc(formatTime(data.fetchedAt))}<br>網頁讀取：${state.readAt ? esc(formatTime(isoInstant(state.readAt))) : '未提供'} · ${state.status === 'error' ? '本次查詢失敗，保留舊資料' : loading ? '正在向 API 查詢，暫示舊資料' : state.cached ? '使用本機快取，未重新查詢 API' : '本次由 API 取得'}${state.expiresAt ? ` · 快取期限：${esc(formatTime(isoInstant(state.expiresAt)))}` : ''}（臺灣時間）</p>` : `<p class="air-note">${loading ? '等待來源回應。' : '尚無可用空氣品質資料；原有天氣功能不受影響。'}</p>`}
    <div class="air-footer"><p class="air-note">來源：<a href="${AIR_SOURCE}" target="_blank" rel="noopener noreferrer">Open-Meteo</a> · <a href="https://ads.atmosphere.copernicus.eu/datasets/cams-global-atmospheric-composition-forecasts" target="_blank" rel="noopener noreferrer">CAMS 全球模式</a> · 約 45 km 網格${data && !compact ? `（${data.grid.latitude}, ${data.grid.longitude}）` : ''}，非行政區獨立測站。<a href="https://confluence.ecmwf.int/spaces/CKB/pages/202173092/CAMS+Regional+European+air+quality+analysis+and+forecast+data+documentation" target="_blank" rel="noopener noreferrer">CAMS 提供者署名</a> · <a href="https://www.airnow.gov/aqi/aqi-basics/" target="_blank" rel="noopener noreferrer">US AQI 分級</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></p><button type="button" class="stock-button" data-air-refresh ${loading ? 'disabled' : ''}>重新查詢空氣品質 API</button></div>
  </section>`;
}

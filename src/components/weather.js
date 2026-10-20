import { icon } from '../lib/icons.js';
import { weatherIcon } from '../lib/weather-icons.js';
import { formatNumber as n, formatTime, dayLabel } from '../lib/format.js';
import { weatherCondition } from '../services/weather.js';
import { DEFAULT_REGION, regionLabel } from '../services/regions.js';
import { escapeHtml } from '../lib/html.js';

export function renderWeather(state) {
  const selected = state.region ?? DEFAULT_REGION;
  const label = escapeHtml(regionLabel(selected));
  if (state.status === 'loading') return `<section class="card state-card" aria-busy="true" role="status"><span class="loader"></span><h2>正在取得 ${label} 天氣</h2><p>連線至 Open-Meteo，請稍候…</p></section>`;
  if (state.status === 'error') return `<section class="card state-card error" role="alert">${icon('info')}<span class="eyebrow">${state.error.kind === 'data' ? 'DATA ERROR' : 'REQUEST ERROR'}</span><h2>${state.error.kind === 'data' ? '資料異常' : state.error.kind === 'location' ? '地區無效' : '連線失敗'}</h2><p>${label}</p><p>${escapeHtml(state.error.message)}</p><button class="primary" data-refresh>${icon('refresh')}重新取得資料</button></section>`;
  const w = state.data, condition = weatherCondition(w.code);
  return `<section class="weather-layout">
    <article class="weather-hero"><div class="hero-top"><span>${icon('pin')}${label}</span><span class="live-dot">最新取得</span></div>
      <div class="current-weather"><div><p class="hero-label">目前氣溫</p><div class="temperature">${n(w.temperature)}<span>°C</span></div><p class="condition">${condition.label}</p></div><div class="weather-art">${weatherIcon(w.code)}</div></div>
      <div class="hero-bottom"><span>今日溫度 <strong>${n(w.forecast[0].low)}° — ${n(w.forecast[0].high)}°</strong></span><span>模式估算 · 非測站觀測</span></div>
    </article>
    <div class="weather-metrics"><article class="card metric"><span class="metric-icon blue">${icon('drop')}</span><div><p>目前相對濕度</p><strong>${n(w.humidity)}<small>%</small></strong><span>依目前天氣模式資料</span></div></article>
    <article class="card metric"><span class="metric-icon teal">${weatherIcon(61)}</span><div><p>今日最高降雨機率</p><strong>${n(w.forecast[0].rain)}<small>${w.forecast[0].rain === null ? '' : '%'}</small></strong><span>${w.forecast[0].rain === null ? '來源未提供此項資料' : '全天預報最高值'}</span></div></article></div>
    <article class="card forecast"><div class="section-heading"><div><span class="eyebrow">LOOKING AHEAD</span><h2>未來七日預報</h2></div><span class="muted">${label} · UTC+8</span></div>
      <div class="forecast-grid">${w.forecast.map((day, i) => { const c = weatherCondition(day.code); return `<div class="forecast-day ${i === 0 ? 'today' : ''}"><strong>${dayLabel(day.date, i)}</strong><time datetime="${day.date}">${day.date.slice(5).replace('-', '/')}</time>${weatherIcon(day.code)}<span class="forecast-condition">${c.label}</span><div class="range">${n(day.high)}° <span>${n(day.low)}°</span></div><span class="rain-chance">${icon('drop')}${n(day.rain)}${day.rain === null ? '' : '%'}</span></div>`; }).join('')}</div>
    </article>
    <div class="source-note">${icon('clock')}<div>預報地區：${label} · 查詢代表點：${selected.latitude}, ${selected.longitude}<br>來源：<a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a> · 數值模式天氣預報，非當地測站即時觀測<br>預報有效時間：${formatTime(w.time)} · 更新（取得）時間：${formatTime(w.fetchedAt)}（臺灣時間）<br>降雨機率為每日最高預報值；「—」表示來源未提供資料。</div></div>
  </section>`;
}

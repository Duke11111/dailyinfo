// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderWeather } from '../src/components/weather.js';
import { DEFAULT_REGION } from '../src/services/regions.js';
const now = Date.parse('2026-10-25T06:00:00Z');
const data = {
  region: DEFAULT_REGION, temperature: 25, humidity: 60, code: 3,
  time: '2026-10-25T14:00+08:00', fetchedAt: '2026-10-25T06:00:00Z',
  forecast: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${25 + i}`, high: 28, low: 21, rain: 20, code: 3 })),
};
function render(state) {
  const host = document.createElement('div');
  host.innerHTML = renderWeather({ region: DEFAULT_REGION, data, ...state }, { now });
  return host;
}
function structure(host) {
  const grid = host.querySelector('.weather-layout');
  return { root: grid.className, children: [...grid.children].map(n => `${n.tagName}.${n.className}`),
    cards: [...grid.querySelectorAll('.weather-hero,.weather-metrics,.weather-metrics>.metric')].map(n => `${n.tagName}.${n.className}`),
    statusClass: grid.querySelector('.weather-update-status').className,
    badgeClass: grid.querySelector('.live-dot').className };
}
it.each(['success', 'error'])('keeps identical grid/card order and layout classes from cached through updating to %s', outcome => {
  const cached = render({ status: 'success', cached: true });
  const loading = render({ status: 'loading', cached: true });
  const settled = render({ status: outcome, cached: outcome === 'error', error: { kind: 'network', message: 'offline' } });
  const expected = structure(cached);
  expect(expected.children).toEqual(['ARTICLE.weather-hero', 'DIV.weather-metrics', 'ARTICLE.card forecast', 'DIV.source-note']);
  expect(structure(loading)).toEqual(expected); expect(structure(settled)).toEqual(expected);
  for (const host of [cached, loading, settled]) {
    expect(host.querySelector('.weather-layout>.storage-status')).toBeNull();
    expect(host.querySelector('.weather-hero>.weather-update-status')).not.toBeNull();
    const metrics = host.querySelector('.weather-metrics');
    expect(metrics.children[0].textContent).toContain('目前相對濕度');
    expect(metrics.children[1].textContent).toContain('今日最高降雨機率');
  }
  expect(loading.querySelector('[role=status]').textContent).toContain('更新中');
  if (outcome === 'error') expect(settled.querySelector('.weather-update-status[role=alert]').textContent).toContain('保留');
});
it('keeps stale-date warnings inside the main card rather than consuming a grid cell', () => {
  const host = render({ status: 'loading', data: { ...data, time: '2026-10-24T23:45+08:00' } });
  expect(host.querySelector('.weather-date-warning').hidden).toBe(false);
  expect(host.querySelector('.weather-hero>.weather-date-warning')).not.toBeNull();
  expect(host.querySelector('.weather-layout').children).toHaveLength(4);
});
it('reserves status height without introducing state-specific layout selectors', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  expect(css).toMatch(/\.weather-update-status\{[^}]*min-height:2\.8em/);
});

// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { markerRadius, earthquakePopup } from '../src/components/earthquake-map.js';
import { formatEarthquakeTime } from '../src/lib/earthquake-format.js';
import { eqFixture } from './fixtures/earthquakes.js';
it('distinguishes magnitudes by bounded marker radius without converting intensity', () => { expect(markerRadius(6)).toBeGreaterThan(markerRadius(3)); expect(markerRadius(null)).toBe(5); expect(markerRadius(99)).toBe(25); });
it('renders popup data as text with seconds, never as external HTML', () => {
  const event = eqFixture().events[0]; event.location = '<img src=x onerror=alert(1)>';
  const popup = earthquakePopup(event); expect(popup.textContent).toContain('<img'); expect(popup.querySelector('img')).toBeNull(); expect(popup.textContent).toContain('11:13:19'); expect(popup.textContent).toContain('2級');
});
it('formats exact occurrence/report times in Taipei regardless of machine timezone', () => { expect(formatEarthquakeTime('2026-10-16T23:40:32.000Z')).toContain('2026/10/17 07:40:32'); expect(formatEarthquakeTime(null)).toBe('未提供'); });

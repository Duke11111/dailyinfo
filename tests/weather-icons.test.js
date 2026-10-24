// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { weatherIcon } from '../src/lib/weather-icons.js';
import { renderWeather } from '../src/components/weather.js';

it.each([[0, 'sun'], [1, 'partlyCloudy'], [2, 'partlyCloudy'], [3, 'cloud'], [45, 'fog'], [48, 'fog'], [51, 'rain'], [61, 'rain'], [82, 'rain'], [71, 'snow'], [86, 'snow'], [95, 'thunderstorm'], [96, 'thunderstorm'], [99, 'thunderstorm'], [999, 'unknown']])('uses the correct visual for weather code %s', (code, name) => {
  document.body.innerHTML = weatherIcon(code);
  expect(document.querySelector('svg').dataset.weatherIcon).toBe(name);
});
it('uses consistent square, unfilled, rounded SVGs without transforms or clipping', () => {
  for (const code of [0, 2, 3, 61, 95, 45, 71, 999]) {
    document.body.innerHTML = weatherIcon(code); const svg = document.querySelector('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24'); expect(svg.getAttribute('width')).toBe(svg.getAttribute('height'));
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet'); expect(svg.getAttribute('stroke')).toBe('currentColor'); expect(svg.getAttribute('stroke-width')).toBe('1.7');
    expect(svg.getAttribute('fill')).toBe('none'); expect(svg.getAttribute('stroke-linecap')).toBe('round'); expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg.querySelector('clipPath, image, foreignObject, [transform]')).toBeNull();
  }
});
it('distinguishes rain, thunderstorm, cloudy and partly cloudy artwork', () => {
  expect(new Set([2, 3, 61, 95].map(weatherIcon)).size).toBe(4);
});
it('renders all seven forecast values unchanged with the matching symbols and today highlight', () => {
  const forecast = [0, 2, 3, 61, 95, 45, 71].map((code, i) => ({ date: `2026-10-${19 + i}`, code, high: 28, low: 21, rain: 30 }));
  document.body.innerHTML = renderWeather({ status: 'success', data: { code: 2, temperature: 26, humidity: 70, time: '2026-10-19T12:00+08:00', fetchedAt: '2026-10-19T04:00:00.000Z', forecast } }, { now: Date.parse('2026-10-19T04:01:00Z') });
  expect(document.querySelector('.weather-art svg').dataset.weatherIcon).toBe('partlyCloudy');
  const days = [...document.querySelectorAll('.forecast-day')]; expect(days).toHaveLength(7); expect(days[0].classList.contains('today')).toBe(true);
  expect(days.map(day => day.querySelector('svg').dataset.weatherIcon)).toEqual(['sun', 'partlyCloudy', 'cloud', 'rain', 'thunderstorm', 'fog', 'snow']);
  expect(days.every(day => day.querySelector('.range').textContent === '28° 21°' && day.querySelector('.rain-chance').textContent === '30%')).toBe(true);
});

// Synthetic fixture for automated tests only, never displayed as live data.
export const airCaptured = '2026-10-19T16:30:00.000Z';
export function airFixture() {
  return { latitude: 25, longitude: 121.5, timezone: 'Asia/Taipei', utc_offset_seconds: 28800,
    current: { time: '2026-10-20T00:00', us_aqi: 45, pm2_5: 8.1, pm10: 10 },
    current_units: { us_aqi: 'USAQI', pm2_5: 'μg/m³', pm10: 'μg/m³' },
    hourly_units: { us_aqi: 'USAQI' }, hourly: { time: Array.from({ length: 24 }, (_, i) => `2026-10-20T${String(i).padStart(2, '0')}:00`), us_aqi: Array.from({ length: 24 }, (_, i) => 45 + i) } };
}

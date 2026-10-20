import { EQ_SOURCE, EQ_SOURCE_URL, mergeEarthquakes, parseEarthquakeResponse } from '../../src/services/earthquakes.js';
export const eqCaptured = '2026-10-19T15:22:52.000Z';
export function rawEarthquake(overrides = {}) {
  return { IssueTime: '2026-10-17T11:16:18+08:00', EarthquakeNo: 2026000, Web: 'https://www.cwa.gov.tw/V8/C/E/EQ/EQ115000-1017-111319.html',
    EarthquakeInfo: { OriginTime: '2026-10-17T11:13:19+08:00', FocalDepth: 25, Epicenter: { Location: '宜蘭縣南澳鄉（自動測試資料）', EpicenterLatitude: 24.5, EpicenterLongitude: 121.7 }, EarthquakeMagnitude: { MagnitudeType: '芮氏規模', MagnitudeValue: 4.6 } },
    Intensity: { ShakingArea: [{ CountyName: '宜蘭縣', InfoStatus: 'observe', AreaIntensity: '2級', EqStation: [{ InfoStatus: 'observe', SeismicIntensity: '2級' }] }, { CountyName: '新北市、臺北市、基隆市、桃園市、新竹縣、新竹市、苗栗縣', AreaIntensity: '1級', InfoStatus: 'observe' }, { CountyName: '臺南市', AreaIntensity: '5強', InfoStatus: 'estimate' }] }, ...overrides };
}
export const rawResponse = (event = rawEarthquake()) => ({ success: 'true', records: { Earthquake: [event] } });
export function eqFixture() {
  const first = parseEarthquakeResponse(rawResponse(), 'E-A0016-001', eqCaptured);
  const secondRaw = rawEarthquake({ IssueTime: '2026-10-13T17:33:00+08:00', EarthquakeNo: 2026069 });
  secondRaw.EarthquakeInfo = { ...secondRaw.EarthquakeInfo, OriginTime: '2026-10-13 17:30:10', Epicenter: { Location: '花蓮縣豐濱鄉（自動測試資料）', EpicenterLatitude: 23.56, EpicenterLongitude: 121.45 }, EarthquakeMagnitude: { MagnitudeType: '芮氏規模', MagnitudeValue: 4.3 } };
  secondRaw.Intensity = { ShakingArea: [{ CountyName: '花蓮縣', InfoStatus: 'observe', AreaIntensity: '3級' }] };
  return { version: 1, source: EQ_SOURCE, sourceUrl: EQ_SOURCE_URL, fetchedAt: eqCaptured, feeds: [{ dataset: 'E-A0015-001', count: 1, fetchedAt: eqCaptured }, { dataset: 'E-A0016-001', count: 1, fetchedAt: eqCaptured }], events: mergeEarthquakes([first, parseEarthquakeResponse(rawResponse(secondRaw), 'E-A0015-001', eqCaptured)]) };
}

import { writeFile } from 'node:fs/promises';
import { fetchWeather, buildWeatherUrl } from '../src/services/weather.js';
import { regions } from '../src/services/regions.js';
const results = [];
for (const label of ['臺北市大安區', '苗栗縣竹南鎮', '高雄市左營區']) {
  const region = regions.find(r => r.county + r.district === label);
  try {
    const data = await fetchWeather({ region });
    results.push({ label, region, success: true, source: 'Open-Meteo', url: buildWeatherUrl(region), temperature: data.temperature, humidity: data.humidity, effectiveTime: data.time, fetchedAt: data.fetchedAt, todayMaxRainProbability: data.forecast[0].rain, forecastDays: data.forecast.length });
  } catch (error) { results.push({ label, success: false, kind: error.kind, error: error.message }); process.exitCode = 1; }
}
await writeFile('data-sources/weather-live-check.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));

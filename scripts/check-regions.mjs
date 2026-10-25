import { isoInstant } from '../src/lib/time.js';
// Independent live comparison against the official NLSC administrative registry.
import { writeFile } from 'node:fs/promises';
import { regions } from '../src/services/regions.js';
const read = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
};
const field = (xml, name) => xml.match(new RegExp(`<${name}>([^<]+)</${name}>`))?.[1];
const xml = await read('https://api.nlsc.gov.tw/other/ListCounty');
const countyItems = [...xml.matchAll(/<countyItem>([\s\S]*?)<\/countyItem>/g)].map(m => ({ code: field(m[1], 'countycode'), name: field(m[1], 'countyname') }));
const official = [];
// Bounded batches to avoid overwhelming the free official service.
for (let start = 0; start < countyItems.length; start += 3) {
  const batch = await Promise.all(countyItems.slice(start, start + 3).map(async county => {
    const towns = await read(`https://api.nlsc.gov.tw/other/ListTown1/${county.code}`);
    return [...towns.matchAll(/<townItem>([\s\S]*?)<\/townItem>/g)].map(m => ({ id: field(m[1], 'towncode'), county: county.name, district: field(m[1], 'townname') }));
  }));
  official.push(...batch.flat());
}
if (official.length !== 368 || regions.some(r => !official.some(o => o.id === r.id && o.county === r.county && o.district === r.district))) throw new Error('Official registry mismatch');
const samples = [];
for (const label of ['臺北市大安區', '苗栗縣竹南鎮', '高雄市左營區']) {
  const r = regions.find(r => r.county + r.district === label);
  const url = `https://api.nlsc.gov.tw/other/TownVillagePointQuery1/${r.longitude}/${r.latitude}/4326`;
  const body = await read(url);
  if (field(body, 'townCode') !== r.id || field(body, 'ctyName') !== r.county || field(body, 'townName') !== r.district) throw new Error(`Point query mismatch: ${label}`);
  samples.push({ ...r, officialPointQuery: 'matched', source: url });
}
const result = { checkedAt: isoInstant(), officialRegistry: 'https://api.nlsc.gov.tw/other/ListTown1', matchedDistricts: official.length, matchedCounties: countyItems.length, samples };
await writeFile('data-sources/regions-live-check.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));

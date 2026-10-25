import { isoInstant } from '../src/lib/time.js';
import { compareSnapshots } from '../src/lib/snapshot-freshness.js';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { snapshotTarget } from './lib/snapshot-target.mjs';
import { fetchCwaEarthquakes } from './lib/cwa-earthquake.mjs';
import { EQ_SOURCE, EQ_SOURCE_URL, parseEarthquakeResponse, mergeEarthquakes, validateEarthquakeSnapshot } from '../src/services/earthquakes.js';

const target = snapshotTarget('earthquakes');
try {
  const responses = await fetchCwaEarthquakes();
  const batches = responses.map(({ data, dataset, fetchedAt }) => parseEarthquakeResponse(data, dataset, fetchedAt));
  if (batches.some(events => !events.length)) throw new Error('其中一類來源無資料，保留既有快照。');
  const snapshot = validateEarthquakeSnapshot({ version: 1, source: EQ_SOURCE, sourceUrl: EQ_SOURCE_URL, fetchedAt: isoInstant(), feeds: responses.map((response, i) => ({ dataset: response.dataset, fetchedAt: response.fetchedAt, count: batches[i].length })), events: mergeEarthquakes(batches) });
  let previous;
  try { previous = validateEarthquakeSnapshot(JSON.parse(await readFile(target, 'utf8'))); } catch (error) { if (error.code !== 'ENOENT') throw new Error('既有快照無法驗證，拒絕覆寫。'); }
  if (previous && compareSnapshots('earthquakes', snapshot, previous) < 0) throw new Error('拒絕以較舊快照覆寫。');
  const output = JSON.stringify(snapshot, null, 2) + '\n';
  if (/CWA-[a-z0-9-]{20,}|Authorization|api[_-]?key/i.test(output)) throw new Error('公開輸出包含禁止的授權欄位，停止更新。');
  const temporary = `${target}.tmp`;
  await writeFile(temporary, output); await rename(temporary, target);
  console.log(JSON.stringify({ fetchedAt: snapshot.fetchedAt, feeds: snapshot.feeds.map(({ dataset, count }) => ({ dataset, count })), events: snapshot.events.length, newest: snapshot.events[0]?.originTime, oldest: snapshot.events.at(-1)?.originTime, latest: snapshot.events.slice(0, 2).map(({ location, magnitude, reportTime, maxIntensity }) => ({ location, magnitude, reportTime, maxIntensity })) }, null, 2));
} catch (error) {
  // Only our controlled messages; never forward arbitrary errors from filesystem or HTTP clients.
  const safe = /^(E-A001[56]-001：|地震|觀測|最大觀測|其中一類|既有快照|拒絕|公開輸出|無法載入本機|請先在)/.test(error.message) ? error.message : '資料驗證或寫入失敗，請檢查來源格式與本機檔案權限。';
  console.error(`地震更新失敗：${safe}`); process.exitCode = 1;
}

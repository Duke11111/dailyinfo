import { CACHE_POLICY } from '../../src/services/cache-policy.js';
import { compareSnapshots } from '../../src/lib/snapshot-freshness.js';
import { isoInstant, nowMs } from '../../src/lib/time.js';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { SIGNS, HOROSCOPE_SOURCE, readingUrl, parseReading, validateHoroscope, taipeiDate } from '../../src/services/horoscope.js';
export async function updateHoroscope({ target, fetchImpl = fetch, now = nowMs } = {}) {
  const startedAt = now(), readings = [];
  // Two bounded workers, one request per sign. No retries, schedules or browser requests.
  let cursor = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (cursor < SIGNS.length) {
      const sign = SIGNS[cursor++].code;
      const response = await fetchImpl(readingUrl(sign), { signal: AbortSignal.timeout(CACHE_POLICY.timeout), redirect: 'error' });
      if (!response.ok) throw Error(`運勢 API ${sign} HTTP ${response.status}`);
      if (!(response.headers.get('content-type') || '').includes('application/json')) throw Error('運勢 API 並非 JSON');
      const text = await response.text(); if (text.length > 1048576) throw Error('運勢回應過大');
      const reading = parseReading(JSON.parse(text), sign);
      if (reading.date !== taipeiDate(startedAt)) throw Error(`來源日期 ${reading.date} 不符合臺灣當日，保留舊快照`);
      readings.push(reading);
    }
  }));
  if (taipeiDate(now()) !== taipeiDate(startedAt)) throw Error('更新跨越臺灣午夜，請稍後手動重試');
  const snapshot = validateHoroscope({ version: 1, source: HOROSCOPE_SOURCE, language: 'en', fetchedAt: isoInstant(now()), readings });
  try {
    const old = validateHoroscope(JSON.parse(await readFile(target, 'utf8')));
    if (compareSnapshots('horoscope', snapshot, old) < 0) throw Error('拒絕回退運勢快照日期');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = `${target}.${process.pid}.tmp`;
  try { await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' }); await rename(temp, target); }
  finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return snapshot;
}

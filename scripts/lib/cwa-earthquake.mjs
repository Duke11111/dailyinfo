import { CACHE_POLICY } from '../../src/services/cache-policy.js';
import { isoInstant } from '../../src/lib/time.js';
import { getCwaApiKey } from './cwa-env.mjs';
export const CWA_DATASETS = ['E-A0015-001', 'E-A0016-001'];
export async function fetchCwaEarthquakes({ fetchImpl = fetch } = {}) {
  const key = getCwaApiKey(), results = [];
  // Stop immediately on authorization/data failure; do not send a second
  // authenticated request when the first dataset has already failed.
  for (const dataset of CWA_DATASETS) {
    // Official header authorization: no credential in URLs, snapshots or logs.
    try {
      const response = await fetchImpl(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/${dataset}?format=JSON`, { headers: { Authorization: key }, signal: AbortSignal.timeout(CACHE_POLICY.timeout), redirect: 'error' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.success !== 'true' && data.success !== true) throw new Error('來源未回報成功');
      results.push({ dataset, data, fetchedAt: isoInstant() });
    } catch (error) {
      // Never forward upstream error bodies, request objects or authenticated headers.
      const safe = /^HTTP \d{3}$/.test(error.message) ? error.message : error.name === 'TimeoutError' || error.name === 'AbortError' ? '連線逾時' : '連線、授權或 JSON 資料失敗';
      throw new Error(`${dataset}：${safe}；既有快照未變更。`);
    }
  }
  return results;
}

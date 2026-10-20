import { it, expect, vi } from 'vitest';
vi.mock('../scripts/lib/cwa-env.mjs', () => ({ getCwaApiKey: () => 'test-only-secret' }));
import { fetchCwaEarthquakes } from '../scripts/lib/cwa-earthquake.mjs';
it('uses official header authorization only and never puts a key in the URL', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ success: 'true', records: {} }) }));
  const data = await fetchCwaEarthquakes({ fetchImpl: fetcher }); expect(data).toHaveLength(2);
  for (const [url, options] of fetcher.mock.calls) { expect(url).not.toContain('test-only-secret'); expect(url).not.toContain('Authorization'); expect(options.headers).toEqual({ Authorization: 'test-only-secret' }); expect(options.redirect).toBe('error'); }
});
it('sanitizes network and upstream JSON errors without forwarding secrets', async () => {
  const request = fetchCwaEarthquakes({ fetchImpl: async () => { throw Error('https://example.test/?Authorization=test-only-secret'); } });
  await expect(request).rejects.toThrow('連線、授權或 JSON 資料失敗'); await expect(request).rejects.not.toThrow('test-only-secret');
});
it('stops after authorization failure without unlimited retries or reading response bodies', async () => {
  const json = vi.fn(), fetcher = vi.fn(async () => ({ ok: false, status: 401, json })); await expect(fetchCwaEarthquakes({ fetchImpl: fetcher })).rejects.toThrow('HTTP 401'); expect(fetcher).toHaveBeenCalledTimes(1); expect(json).not.toHaveBeenCalled();
});

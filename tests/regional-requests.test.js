import { it, expect, vi } from 'vitest';
import { createRegionalRequests } from '../src/services/regional-requests.js';
import { DEFAULT_REGION } from '../src/services/regions.js';

it('coalesces identical regional requests without letting one consumer cancel another', async () => {
  let finish; const fetcher = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const pool = createRegionalRequests(fetcher), first = new AbortController(), second = new AbortController();
  const a = pool.load({ region: DEFAULT_REGION, signal: first.signal }), b = pool.load({ region: DEFAULT_REGION, signal: second.signal });
  await Promise.resolve(); expect(fetcher).toHaveBeenCalledTimes(1);
  const rejection = expect(a).rejects.toMatchObject({ name: 'AbortError' }); first.abort(); await rejection;
  expect(fetcher.mock.calls[0][0].signal.aborted).toBe(false); finish('verified response'); expect(await b).toBe('verified response'); pool.dispose();
});
it('aborts transport only after the last consumer leaves, without retrying automatically', async () => {
  let finish; const fetcher = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const pool = createRegionalRequests(fetcher), controller = new AbortController();
  const request = pool.load({ region: DEFAULT_REGION, signal: controller.signal }); await Promise.resolve();
  const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejection;
  expect(fetcher.mock.calls[0][0].signal.aborted).toBe(true); finish('late ignored response'); await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(1); pool.dispose();
});
it('releases failures for an explicit subsequent request and rejects invalid coordinates', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce('recovered');
  const pool = createRegionalRequests(fetcher);
  await expect(pool.load({ region: { ...DEFAULT_REGION, latitude: 0 } })).rejects.toThrow('座標'); expect(fetcher).not.toHaveBeenCalled();
  await expect(pool.load({ region: DEFAULT_REGION })).rejects.toThrow('offline');
  expect(await pool.load({ region: DEFAULT_REGION })).toBe('recovered'); expect(fetcher).toHaveBeenCalledTimes(2); pool.dispose();
});

import { it, expect, vi } from 'vitest';
import { createWeatherSession, WEATHER_TTL } from '../src/services/weather-session.js';
import { DEFAULT_REGION, getRegion } from '../src/services/regions.js';

const zhunan = getRegion('10005040'), zhongshan = getRegion('63000040');
const time = Date.parse('2026-10-22T00:00:00Z');
const data = (region, stamp = time) => ({ region, temperature: 25, fetchedAt: new Date(stamp).toISOString() });
it('shares successful regional cache records without sharing either view state or original fetch time', async () => {
  const cache = new Map(), fetcher = vi.fn(async ({ region }) => data(region));
  const home = createWeatherSession({ cache, fetcher, now: () => time }), page = createWeatherSession({ cache, fetcher, now: () => time });
  await home.load(zhunan); await page.load(zhunan); expect(fetcher).toHaveBeenCalledTimes(1); expect(page.state.cached).toBe(true);
  expect(page.lastAttemptAt).toBe(time); // A fresh shared result must not cause an immediate timer refetch.
  await page.load(zhongshan); expect(home.state.region).toBe(zhunan); expect(page.state.region).toBe(zhongshan);
  await home.load(); expect(fetcher).toHaveBeenCalledTimes(2); expect(home.state.data.fetchedAt).toBe(new Date(time).toISOString());
  home.dispose(); page.dispose();
});
it('coalesces repeated requests in a view and ignores late responses from the previous region', async () => {
  let finish; const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockImplementation(async ({ region }) => data(region));
  const session = createWeatherSession({ fetcher, now: () => time });
  const old = session.load(zhunan); expect(session.load(zhunan)).toBe(old); await Promise.resolve();
  const signal = fetcher.mock.calls[0][0].signal;
  await session.load(zhongshan); expect(signal.aborted).toBe(true);
  finish(data(zhunan)); await old; expect(session.state.region).toBe(zhongshan); expect(session.state.data.region).toBe(zhongshan);
  expect(fetcher).toHaveBeenCalledTimes(2); session.dispose();
});
it('expires cache after fifteen minutes, permits explicit refresh and preserves timestamps', async () => {
  let stamp = time; const fetcher = vi.fn(async ({ region }) => data(region, stamp));
  const session = createWeatherSession({ fetcher, now: () => stamp });
  await session.load(); stamp += 1000; await session.load(); expect(fetcher).toHaveBeenCalledTimes(1);
  await session.load(undefined, { force: true }); expect(fetcher).toHaveBeenCalledTimes(2);
  stamp += WEATHER_TTL; await session.load(); expect(fetcher).toHaveBeenCalledTimes(3); session.dispose();
});
it('rejects forged coordinates and mismatched response regions without caching or inventing data', async () => {
  const cache = new Map(), fetcher = vi.fn(async () => data(zhongshan));
  const session = createWeatherSession({ cache, fetcher, now: () => time });
  await session.load({ ...DEFAULT_REGION, latitude: 0 }); expect(fetcher).not.toHaveBeenCalled(); expect(session.state.status).toBe('error');
  await session.load(zhunan); expect(session.state.status).toBe('error'); expect(session.state.data).toBeNull(); expect(cache.size).toBe(0); session.dispose();
});
it('isolates failed requests between views and cancels disposed pending work', async () => {
  let finish; const onChange = vi.fn();
  const home = createWeatherSession({ fetcher: async ({ region }) => data(region), now: () => time }); await home.load(zhunan);
  const page = createWeatherSession({ fetcher: async () => { throw Error('offline'); } }); await page.load(zhongshan);
  expect(page.state.status).toBe('error'); expect(home.state.status).toBe('success'); expect(home.state.region).toBe(zhunan);
  const pending = createWeatherSession({ onChange, fetcher: () => new Promise(resolve => { finish = resolve; }) }); const request = pending.load(); await Promise.resolve();
  pending.dispose(); const count = onChange.mock.calls.length; finish(data(DEFAULT_REGION)); await request; expect(onChange).toHaveBeenCalledTimes(count);
  home.dispose(); page.dispose();
});

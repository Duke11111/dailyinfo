// @vitest-environment jsdom
import { beforeEach, it, expect, vi } from 'vitest';
import { loadOverviewRegion, saveOverviewRegion, OVERVIEW_REGION_KEY } from '../src/services/overview-region.js';
import { DEFAULT_REGION, REGION_KEY, getRegion } from '../src/services/regions.js';

beforeEach(() => localStorage.clear());
it('starts unsaved at the safe default without copying or changing the full-page selection', () => {
  localStorage.setItem(REGION_KEY, JSON.stringify({ id: '10005040' }));
  expect(loadOverviewRegion()).toEqual({ region: DEFAULT_REGION, saved: false, problem: '' });
  expect(localStorage.getItem(OVERVIEW_REGION_KEY)).toBeNull();
  expect(JSON.parse(localStorage.getItem(REGION_KEY)).id).toBe('10005040');
});
it('persists only the canonical ID and restores it independently from other storage', () => {
  localStorage.setItem(REGION_KEY, JSON.stringify({ id: '63000040' })); localStorage.setItem('other', 'preserve');
  expect(saveOverviewRegion('10005040')).toMatchObject({ saved: true, region: getRegion('10005040') });
  expect(JSON.parse(localStorage.getItem(OVERVIEW_REGION_KEY))).toEqual({ id: '10005040' });
  expect(loadOverviewRegion().region).toBe(getRegion('10005040'));
  expect(JSON.parse(localStorage.getItem(REGION_KEY)).id).toBe('63000040'); expect(localStorage.getItem('other')).toBe('preserve');
});
it.each(['broken', 'null', '[]', '"10005040"', '{"id":"unknown"}', '{"id":123}', '{"id":"10005040","latitude":0}'])('rejects malformed or untrusted stored data without overwriting it: %s', raw => {
  localStorage.setItem(OVERVIEW_REGION_KEY, raw);
  expect(loadOverviewRegion()).toMatchObject({ saved: false, region: DEFAULT_REGION });
  expect(loadOverviewRegion().problem).toContain('原始設定未被改寫'); expect(localStorage.getItem(OVERVIEW_REGION_KEY)).toBe(raw);
});
it('reports denied reads and failed writes without reporting success or replacing the original value', () => {
  const denied = { getItem: () => { throw Error('denied'); } }; expect(loadOverviewRegion(denied).saved).toBe(false);
  const storage = { getItem: () => '{"id":"10005040"}', setItem: vi.fn(() => { throw Error('quota'); }) };
  expect(() => saveOverviewRegion(DEFAULT_REGION.id, storage)).toThrow('無法儲存');
  expect(loadOverviewRegion(storage).region.id).toBe('10005040');
  expect(() => saveOverviewRegion('../invalid', storage)).toThrow('有效'); expect(storage.setItem).toHaveBeenCalledTimes(1);
});

import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rawResponse, eqCaptured, eqFixture } from './fixtures/earthquakes.js';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), read: vi.fn(), write: vi.fn(), rename: vi.fn() }));
vi.mock('../scripts/lib/cwa-earthquake.mjs', () => ({ fetchCwaEarthquakes: mocks.fetch }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.read, writeFile: mocks.write, rename: mocks.rename }));
let priorExit;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); priorExit = process.exitCode;
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.fetch.mockResolvedValue(['E-A0015-001', 'E-A0016-001'].map(dataset => ({ dataset, data: rawResponse(), fetchedAt: eqCaptured })));
  mocks.read.mockRejectedValue(Object.assign(Error(), { code: 'ENOENT' })); mocks.write.mockResolvedValue(); mocks.rename.mockResolvedValue();
});
afterEach(() => { process.exitCode = priorExit; vi.restoreAllMocks(); });
it('writes only a normalized public snapshot after both sources validate, then atomically renames', async () => {
  await import('../scripts/update-earthquakes.mjs'); expect(mocks.write).toHaveBeenCalledTimes(1); expect(mocks.rename).toHaveBeenCalledTimes(1);
  const data = JSON.parse(mocks.write.mock.calls[0][1]); expect(data.events).toHaveLength(1); expect(data.events[0].reports).toHaveLength(2); expect(mocks.write.mock.calls[0][1]).not.toMatch(/Authorization|CWA-[a-z0-9-]{20,}/i);
  expect(mocks.write.mock.invocationCallOrder[0]).toBeLessThan(mocks.rename.mock.invocationCallOrder[0]);
});
it('never overwrites a valid snapshot when the API fails and suppresses raw secrets', async () => {
  mocks.fetch.mockRejectedValue(Error('private request containing test-only-secret')); await import('../scripts/update-earthquakes.mjs');
  expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.rename).not.toHaveBeenCalled(); expect(console.error.mock.calls.flat().join(' ')).not.toContain('test-only-secret'); expect(process.exitCode).toBe(1);
});
it('preserves existing data if either source is malformed or empty', async () => {
  mocks.fetch.mockResolvedValue([{ dataset: 'E-A0015-001', data: rawResponse(), fetchedAt: eqCaptured }, { dataset: 'E-A0016-001', data: { success: true, records: { Earthquake: [] } }, fetchedAt: eqCaptured }]);
  await import('../scripts/update-earthquakes.mjs'); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.rename).not.toHaveBeenCalled();
});
it('refuses to overwrite a corrupt or newer existing snapshot', async () => {
  mocks.read.mockResolvedValue(JSON.stringify({ ...eqFixture(), fetchedAt: '2099-01-01T00:00:00.000Z' })); await import('../scripts/update-earthquakes.mjs'); expect(mocks.write).not.toHaveBeenCalled();
});

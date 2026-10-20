import { it, expect } from 'vitest';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { updateExchange } from '../scripts/lib/exchange-import.mjs';
import { exchangeFixture, exchangeCsv, exchangeHtml, exchangeCaptured } from './fixtures/exchange.js';
async function files(test) {
  const folder = new URL('../node_modules/.cache/', import.meta.url); await mkdir(folder, { recursive: true }); const target = new URL(`exchange-test-${randomUUID()}.json`, folder);
  try { await test(target); } finally { for (const path of [target, new URL(target.href + '.tmp')]) try { await unlink(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
const fakeFetch = (csv = exchangeCsv(), html = exchangeHtml()) => async url => ({ ok: true, headers: new Headers({ 'content-type': url.includes('flcsv') ? 'text/csv' : 'text/html' }), text: async () => url.includes('flcsv') ? csv : html });
it('writes a verified, timestamped snapshot that works without API keys', async () => files(async target => {
  const data = await updateExchange({ target, fetchImpl: fakeFetch(), now: () => Date.parse(exchangeCaptured) }); expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(data); expect(data.rates[3].spot.buy).toBeNull();
}));
it.each(['http', 'mismatch', 'older', 'invalid-json'])('preserves existing file bytes when update fails: %s', async scenario => files(async target => {
  const before = scenario === 'invalid-json' ? '{broken' : JSON.stringify(exchangeFixture()); await writeFile(target, before);
  const options = { target, now: () => Date.parse(exchangeCaptured), fetchImpl: scenario === 'http' ? async () => ({ ok: false }) : scenario === 'mismatch' ? fakeFetch(exchangeCsv().replace('32.00000', '31.00000')) : scenario === 'older' ? fakeFetch(exchangeCsv(), exchangeHtml().replace('2026/10/20', '2026/10/19')) : fakeFetch() };
  await expect(updateExchange(options)).rejects.toThrow(); expect(await readFile(target, 'utf8')).toBe(before);
}));

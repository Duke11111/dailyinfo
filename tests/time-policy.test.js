import { it, expect, vi, afterEach } from 'vitest';
import { taipeiDate, formatTaipei, isoInstant, olderThan, DAY_MS, validDateOnly, calendarWeekday, optionalUpdatedAt } from '../src/lib/time.js';
import { parseQuoteRows, validateQuoteSnapshot, createQuoteStore } from '../src/services/quotes.js';
import { quoteRows } from './fixtures/quotes.js';
import { scheduleDecision } from '../scripts/lib/source-schedule.mjs';
afterEach(() => vi.useRealTimers());
it.each([
  ['2026-10-21T15:59:59Z', '2026-10-21'], ['2026-10-21T16:00:00Z', '2026-10-22'],
  ['2026-10-21T23:59:59Z', '2026-10-22'], ['2026-10-22T00:00:00Z', '2026-10-22'],
  ['2026-10-22T15:59:59Z', '2026-10-22'], ['2026-10-22T16:00:00Z', '2026-10-23'],
])('classifies %s in Taiwan, independent of runner/browser timezone', (instant, date) => expect(taipeiDate(instant)).toBe(date));
it('formats Taiwan midnight as 00 rather than UTC or 24:00', () => {
  expect(formatTaipei('2026-10-21T16:00:00Z')).toBe('2026/10/22 00:00');
  expect(formatTaipei('2026-10-22T00:00:00+08:00')).toBe(formatTaipei('2026-10-21T16:00:00Z'));
});
it('keeps UTC serialization explicit and rejects ambiguous wall-clock instants', () => {
  expect(isoInstant('2026-10-22T00:00:00+08:00')).toBe('2026-10-21T16:00:00.000Z');
  expect(() => isoInstant('2026-10-22T00:00:00')).toThrow();
  expect(validDateOnly('2026-02-30')).toBe(false);
});
it.each([[23 * 3600000 + 59 * 60000, false], [24 * 3600000 + 60000, true]])('uses elapsed duration %s rather than day strings', (duration, stale) => {
  const fetchedAt = '2026-10-21T15:59:00Z';
  expect(olderThan(fetchedAt, DAY_MS, Date.parse(fetchedAt) + duration)).toBe(stale);
});
it('retains the official trade date through weekends and a synthetic holiday with no rows', () => {
  const rows = quoteRows().map(row => ({ ...row, Date: '1151022' }));
  const snapshot = parseQuoteRows(rows, '2026-10-25T01:00:00Z');
  expect(snapshot.tradeDate).toBe('2026-10-22');
  expect(validateQuoteSnapshot(snapshot).tradeDate).toBe('2026-10-22');
  expect(calendarWeekday('2026-10-25')).toBe(0);
  expect(scheduleDecision('quotes', { sources: {} }, Date.parse('2026-10-25T12:00:00Z')).reason).toBe('weekend');
  expect(() => parseQuoteRows([], '2026-10-23T12:00:00Z')).toThrow(); // No invented holiday rows.
});
it('accepts official 10/22 over 10/21 and refuses a stale response afterwards', async () => {
  let clock = Date.parse('2026-10-22T12:00:00Z');
  const snapshot = day => parseQuoteRows(quoteRows().map(r => ({ ...r, Date: day })), isoInstant(clock));
  const fetcher = vi.fn().mockResolvedValueOnce(snapshot('1151021'));
  const store = createQuoteStore({ fetcher, now: () => clock }); await store.load();
  clock += 10001; fetcher.mockResolvedValueOnce(snapshot('1151022')); await store.load({ force: true });
  expect(store.peek().tradeDate).toBe('2026-10-22');
  clock += 10001; fetcher.mockResolvedValueOnce(snapshot('1151021'));
  await expect(store.load({ force: true })).rejects.toThrow('較舊'); expect(store.peek().tradeDate).toBe('2026-10-22');
});
it('does not substitute fetch or update dates for trading dates, and validates update provenance', () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-25T01:00:00Z');
  const data = { fetchedAt: '2026-10-24T12:00:00Z', updatedAt: '2026-10-24T13:00:00Z' };
  expect(optionalUpdatedAt(data)).toEqual({ updatedAt: data.updatedAt });
  expect(optionalUpdatedAt({ fetchedAt: data.fetchedAt })).toEqual({});
  expect(() => optionalUpdatedAt({ ...data, updatedAt: '2026-10-26T00:00:00Z' })).toThrow();
});

// Synthetic checkpoint data only: never read or publish production snapshots.
import { quoteFixture } from './quotes.js';
import { newsFixture } from './news.js';
import { eqFixture } from './earthquakes.js';
import { SIGNS, HOROSCOPE_SOURCE } from '../../src/services/horoscope.js';

export const CHECKPOINT_NOW = Date.parse('2026-10-20T12:00:00Z');
const captured = '2026-10-20T11:00:00.000Z';

// Each invocation returns fresh objects; every source date precedes the test clock.
export function checkpointFixture(source) {
  const factories = {
    quotes: quoteFixture,
    news: newsFixture,
    earthquakes: eqFixture,
    horoscope: () => ({ version: 1, source: HOROSCOPE_SOURCE, language: 'en',
      readings: SIGNS.map(({ code }) => ({ sign: code, date: '2026-10-20', text: 'Synthetic checkpoint test only.' })) }),
  };
  if (!Object.hasOwn(factories, source)) throw Error('Unknown fixture source');
  return { ...factories[source](), fetchedAt: captured };
}

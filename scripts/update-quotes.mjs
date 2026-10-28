import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { snapshotTarget } from './lib/snapshot-target.mjs';
import { fetchLatestQuotes } from './lib/twse-quotes.mjs';
import { validateQuoteSnapshot } from '../src/services/quotes.js';
try {
  const target = snapshotTarget('quotes');
  let previous = null;
  try { previous = validateQuoteSnapshot(JSON.parse(await readFile(target, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw Error(); }
  const data = await fetchLatestQuotes({ previous });
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target + '.tmp', JSON.stringify(data, null, 2) + '\n');
  await rename(target + '.tmp', target);
  console.log(JSON.stringify({ source: data.source, method: data.evidence.method, fetchedAt: data.fetchedAt,
    tradeDate: data.tradeDate, expectedTradeDate: data.evidence.eligibleTradeDate, count: data.quotes.length }));
} catch {
  console.error('TWSE quote update failed: official response, date or validation unavailable; previous snapshot preserved.');
  process.exitCode = 1;
}

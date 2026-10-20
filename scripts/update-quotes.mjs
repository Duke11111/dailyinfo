import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { snapshotTarget } from './lib/snapshot-target.mjs';
import { parseQuoteRows, validateQuoteSnapshot, QUOTE_SOURCE } from '../src/services/quotes.js';

const response = await fetch(QUOTE_SOURCE, { headers: { Origin: 'http://127.0.0.1:5173' }, signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`TWSE HTTP ${response.status}; existing snapshot preserved`);
const raw = await response.text();
const data = parseQuoteRows(JSON.parse(raw));
data.sha256 = createHash('sha256').update(raw).digest('hex');
data.responseHeaders = { allowOrigin: response.headers.get('access-control-allow-origin'), cacheControl: response.headers.get('cache-control'), rateLimit: response.headers.get('ratelimit-limit') };
const target = snapshotTarget('quotes');
let previous = null;
try { previous = validateQuoteSnapshot(JSON.parse(await readFile(target, 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Existing snapshot cannot be validated; inspect it before replacing.'); }
if (previous && data.tradeDate < previous.tradeDate) throw new Error('Refusing older trading date; existing snapshot preserved');
await mkdir('public/data', { recursive: true });
await writeFile(`${target}.tmp`, JSON.stringify(data, null, 2) + '\n');
await rename(`${target}.tmp`, target);
console.log(JSON.stringify({ source: data.source, fetchedAt: data.fetchedAt, tradeDate: data.tradeDate, count: data.quotes.length, headers: data.responseHeaders, samples: data.quotes.filter(q => ['2330', '2454', '0050'].includes(q.code)) }, null, 2));

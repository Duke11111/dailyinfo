import { isoInstant } from '../src/lib/time.js';
// Explicit maintenance command; normal builds and user searches do not call TWSE.
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateCatalog } from '../src/services/stock-catalog.js';

const definitions = [
  { path: 't187ap03_L', label: '上市公司基本資料', type: 'stock', code: '公司代號', name: '公司簡稱', fullName: '公司名稱', dataset: 'https://data.gov.tw/dataset/18419' },
  { path: 't187ap47_L', label: '基金基本資料彙總表', type: 'etf', code: '基金代號', name: '基金簡稱', fullName: '基金中文名稱', dataset: 'https://data.gov.tw/dataset/157399' },
];
function rocDate(value) {
  if (!/^\d{7}$/.test(value)) throw new Error('Unexpected ROC date');
  const date = `${Number(value.slice(0, 3)) + 1911}-${value.slice(3, 5)}-${value.slice(5)}`;
  if (!Number.isFinite(Date.parse(date))) throw new Error('Invalid date');
  return date;
}
const stocks = [], sources = [];
for (const def of definitions) {
  const url = `https://openapi.twse.com.tw/v1/opendata/${def.path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Origin: 'http://127.0.0.1:5173' } });
  if (!response.ok) throw new Error(`TWSE HTTP ${response.status}; keeping existing snapshot`);
  const raw = await response.text(), rows = JSON.parse(raw);
  if (!Array.isArray(rows) || !rows.length) throw new Error('Empty TWSE response; keeping existing snapshot');
  const issuedDates = [...new Set(rows.map(row => rocDate(row['出表日期'])))].sort();
  sources.push({ label: def.label, url, dataset: def.dataset, count: rows.length, issuedDates,
    sha256: createHash('sha256').update(raw).digest('hex'),
    corsAllowOrigin: response.headers.get('access-control-allow-origin'), cacheControl: response.headers.get('cache-control'),
    rateLimit: response.headers.get('ratelimit-limit') ?? response.headers.get('x-ratelimit-limit'),
    publishedUpdateFrequency: '政府資料開放平臺標示每1月；實際出表日另列，非即時保證。',
  });
  stocks.push(...rows.map(row => ({ code: row[def.code]?.trim(), name: row[def.name]?.trim(), fullName: row[def.fullName]?.trim(), type: def.type })));
}
const data = validateCatalog({ version: 1, fetchedAt: isoInstant(), sources, stocks: stocks.sort((a, b) => a.code.localeCompare(b.code)) });
await mkdir('public/data', { recursive: true });
// Validate both complete responses first, then replace a single snapshot atomically.
await writeFile('public/data/stocks.json.tmp', JSON.stringify(data, null, 2) + '\n');
await rename('public/data/stocks.json.tmp', 'public/data/stocks.json');
console.log(JSON.stringify({ fetchedAt: data.fetchedAt, sources, total: data.stocks.length }, null, 2));

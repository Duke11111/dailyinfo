import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { snapshotSourceDate } from './src/lib/snapshot-freshness.js';
const baseline = Object.fromEntries(['quotes', 'news', 'earthquakes', 'horoscope'].map(source => {
  const data = JSON.parse(readFileSync(fileURLToPath(new URL(`./public/data/${source}.json`, import.meta.url)), 'utf8'));
  return [source, { sourceDate: snapshotSourceDate(source, data), fetchedAt: data.fetchedAt }];
}));

export default defineConfig(({ mode }) => ({
  base: '/dailyinfo/',
  // Data identity travels with the code: old persisted cache cannot suppress a
  // fetch when this program was built against a newer validated baseline.
  define: { __DAILYINFO_BASELINE__: JSON.stringify(mode === 'test' ? {} : baseline) },
  // Avoid Windows worker contention; retain the tests' original VM deadlines.
  test: { maxWorkers: process.platform === 'win32' ? 2 : undefined },
}));

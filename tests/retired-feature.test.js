import { it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { SOURCES, CORE_SOURCES } from '../scripts/lib/data-automation.mjs';
it('has only four update sources and five public JSON files including the stock catalog', async () => {
  expect(SOURCES).toEqual(['quotes','news','earthquakes','horoscope']); expect(CORE_SOURCES).toEqual(SOURCES);
  expect((await readdir('public/data')).sort()).toEqual(['earthquakes.json','horoscope.json','news.json','quotes.json','stocks.json']);
  expect(JSON.parse(await readFile('package.json')).scripts).not.toHaveProperty('update:exchange');
});
it('has no retired routes, imports or bank endpoints anywhere in frontend source', async () => {
  async function check(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const path = dir + '/' + e.name;
      if (e.isDirectory()) await check(path);
      else expect(await readFile(path, 'utf8')).not.toMatch(/rate\.bot\.com\.tw|view=exchange|mountExchange|services\/exchange|exchange\.css|匯率|換算器/);
    }
  }
  await check('src');
});
it('keeps the v1 archive compatibility layer read-only and outside frontend imports', async () => {
  const code = await readFile('scripts/lib/legacy-checkpoint.mjs', 'utf8');
  expect(code).not.toMatch(/\bfetch\s*\(|execFile|writeFile|XMLHttpRequest|https\.get|http\.get/);
  expect(await readFile('src/main.js','utf8')).not.toContain('legacy-checkpoint');
});

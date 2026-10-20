import { it, expect, vi } from 'vitest';
import { readdir, readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { updateData, verifyPublicTree } from '../scripts/lib/data-automation.mjs';
import { quoteFixture } from './fixtures/quotes.js';

it('pins every workflow action to an independently recorded full official SHA', async () => {
  const workflow = await readFile('.github/workflows/data-update.yml', 'utf8'), evidence = await readFile('docs/ACTIONS_PINS.md', 'utf8');
  const uses = [...workflow.matchAll(/uses:\s+(actions\/[a-z-]+)@([^\s#]+)/g)];
  expect(uses.length).toBeGreaterThanOrEqual(6);
  for (const [, name, sha] of uses) { expect(sha).toMatch(/^[a-f0-9]{40}$/); expect(evidence).toContain(name); expect(evidence).toContain(`https://github.com/${name}/commit/${sha}`); }
});
it('ignores secrets without excluding source, tests, samples or required snapshots', () => {
  const ignored = path => { try { execFileSync('git', ['check-ignore', '-q', '--', path], { stdio: 'ignore' }); return true; } catch { return false; } };
  for (const file of ['.env.local', '.env', 'secret.pem', 'secret.key', 'secret.pfx', 'secret.p12', 'id_rsa', 'id_ed25519', 'credentials.json', '.npmrc']) expect(ignored(file)).toBe(true);
  for (const file of ['.env.example', 'src/main.js', 'tests/data-automation.test.js', 'public/data/quotes.json', 'public/data/horoscope.json']) expect(ignored(file)).toBe(false);
});
it('has no private home paths or personal webmail addresses in publishable text', async () => {
  async function walk(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', '.cache', 'coverage'].includes(entry.name)) continue;
    const file = join(dir, entry.name); if (entry.isDirectory()) { await walk(file); continue; }
    if (/\.(?:png|jpg|jpeg|gif|webp|ico)$/.test(file)) continue;
    const text = await readFile(file, 'utf8');
    expect(text, file).not.toMatch(/[A-Z]:[\\/]+Users[\\/]+[A-Za-z0-9._-]+[\\/]|\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\//i);
    expect(text, file).not.toMatch(/\b[A-Z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo|icloud|protonmail)\.[A-Z.]+\b/i);
  } }
  await walk(resolve('.'));
});
it('does not pass the CWA secret to unrelated data updater child processes', async () => {
  const base = resolve('.cache/public-security-tests'); await mkdir(base, { recursive: true }); const root = await mkdtemp(join(base, 'test-'));
  vi.stubEnv('CWA_API_KEY', 'synthetic-test-only-key');
  try {
    await mkdir(join(root, 'public/data'), { recursive: true }); await mkdir(join(root, 'scripts'));
    const fixture = quoteFixture(); await writeFile(join(root, 'public/data/quotes.json'), JSON.stringify(fixture));
    await writeFile(join(root, 'scripts/update-quotes.mjs'), `import {writeFileSync} from 'node:fs'; if (process.env.CWA_API_KEY) process.exit(9); writeFileSync(process.env.DAILYINFO_DATA_DIR+'/quotes.json', ${JSON.stringify(JSON.stringify(fixture))});`);
    const report = await updateData({ root, sources: ['quotes'] }); expect(report.failed).toBe(0); expect(report.changed).toBe(false);
    for (const name of ['secret.pfx', 'secret.p12', 'id_rsa', 'credentials.json']) { const path = join(root, 'public', name); await writeFile(path, 'synthetic test only'); await expect(verifyPublicTree(join(root, 'public'))).rejects.toThrow(); await rm(path); }
  } finally { vi.unstubAllEnvs(); if (!root.startsWith(base + sep)) throw Error('Invalid cleanup path'); await rm(root, { recursive: true }); }
});

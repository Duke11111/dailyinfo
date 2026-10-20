import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import config from '../vite.config.js';
import { assertPublishableText, builtAssetPath } from '../scripts/lib/deployment-check.mjs';

it('uses the Pages subpath and rejects root-relative or escaping assets', () => {
  expect(config.base).toBe('/dailyinfo/');
  expect(builtAssetPath('/dailyinfo/assets/app.js', 'dist')).toBe(resolve('dist/assets/app.js'));
  for (const url of ['/assets/app.js', '/dailyinfo/../private', '/dailyinfo/%2e%2e/private']) expect(() => builtAssetPath(url, 'dist')).toThrow();
});
it('rejects private paths, personal email and secret patterns without requiring a real key', () => {
  for (const text of ['C:' + '/Users/' + 'sample/private.txt', 'sample' + '@gmail.com', 'CWA-' + 'a'.repeat(36)]) expect(() => assertPublishableText(text)).toThrow();
  expect(() => assertPublishableText('Official public snapshot, no credentials')).not.toThrow();
});
it('keeps Pages manual, secret-free and independent from data updates', async () => {
  const workflow = await readFile('.github/workflows/pages-manual.yml', 'utf8');
  expect(workflow).toContain('workflow_dispatch:');
  expect(workflow).not.toMatch(/^\s+(?:schedule|push|pull_request|workflow_run):/m);
  expect(workflow).not.toMatch(/secrets\.|CWA_API_KEY|npm run update|contents: write/);
  expect(workflow).toContain('node-version: \'24\'');
  expect(workflow).toContain('npm ci --ignore-scripts');
  expect(workflow).toContain('npm test');
  expect(workflow).toContain('npm run build -- --base=/dailyinfo/');
  expect(workflow).toContain('npm run verify -- --dist');
  const [build, deploy] = workflow.split('\n  deploy:');
  expect(build).toContain('contents: read');
  expect(build).not.toMatch(/pages: write|id-token: write/);
  expect(deploy).toContain('needs: build');
  expect(deploy).toContain('pages: write');
  expect(deploy).toContain('id-token: write');
  const pins = await readFile('docs/ACTIONS_PINS.md', 'utf8');
  for (const [, action, sha] of workflow.matchAll(/uses: (actions\/[\w-]+)@([a-f0-9]{40})/g)) expect(pins).toContain(`https://github.com/${action}/commit/${sha}`);
});

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { guardPublication, REPOSITORY, SITE, FILES } from './lib/publish-guard.mjs';

// Only this explicit CI entrypoint reads GitHub/site metadata. Unit tests inject both transports.
try {
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY || process.env.GITHUB_REF !== 'refs/heads/main') throw Error();
  const api = async path => JSON.parse(execFileSync('gh', ['api', path], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 2097152, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  }));
  const readPublished = async path => {
    if (!['release-manifest.json', ...FILES.map(name => `data/${name}.json`)].includes(path)) throw Error();
    const url = new URL(path, SITE); url.searchParams.set('release-check', randomUUID());
    const response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'error',
      cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
    if (path === 'release-manifest.json' && response.status === 404) {
      await response.body?.cancel(); throw Object.assign(Error('Manifest missing'), { safeCode: 'release_manifest_missing' });
    }
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw Error();
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 4 * 1024 * 1024) throw Error(); chunks.push(chunk); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  };
  if (process.env.INITIALIZE_MANIFEST && !['true', 'false'].includes(process.env.INITIALIZE_MANIFEST)) throw Error();
  const bootstrap = process.env.INITIALIZE_MANIFEST === 'true'
    ? { approvalText: await readFile('data-sources/release-baseline.json', 'utf8'), env: process.env } : undefined;
  if (!bootstrap && process.env.BASELINE_APPROVAL) throw Error();
  const result = await guardPublication({ directory: 'dist', api, readPublished, bootstrap, identity: {
    repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA,
    runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  } });
  if (result.initialized) console.log('Approved initial deployment baseline verified; first release data is byte-identical.');
  console.log('Published deployment provenance, manifest, five snapshots and non-regression verified.');
} catch {
  console.error('Publication guard refused an unavailable, inconsistent or regressing baseline. No raw responses or credentials logged.');
  process.exitCode = 1;
}

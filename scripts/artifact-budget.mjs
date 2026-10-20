import { execFileSync } from 'node:child_process';
import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { assertArtifactBudget } from './lib/release-policy.mjs';
try {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw Error();
  const info = JSON.parse(execFileSync('gh', ['api', `repos/${repository}`], { encoding: 'utf8', timeout: 30000, maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'] }));
  if (info.visibility !== 'public') throw Error();
  const artifacts = [];
  for (let page = 1; ; page++) {
    if (page > 10) throw Error();
    const result = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/actions/artifacts?per_page=100&page=${page}`], { encoding: 'utf8', timeout: 30000, maxBuffer: 2097152, stdio: ['ignore', 'pipe', 'pipe'] }));
    if (!Array.isArray(result.artifacts)) throw Error();
    artifacts.push(...result.artifacts);
    if (result.artifacts.length < 100) break;
  }
  assertArtifactBudget(artifacts);
  async function size(directory) {
    let bytes = 0;
    for (const name of await readdir(directory)) {
      const path = join(directory, name), stat = await lstat(path);
      if (stat.isSymbolicLink()) throw Error();
      bytes += stat.isDirectory() ? await size(path) : stat.size;
    }
    return bytes;
  }
  if (process.argv.includes('--upload')) {
    if (await size('.cache/data-state') > 1024 * 1024) throw Error();
    if (process.env.HAS_BUILD === 'true' && await size('dist') > 8 * 1024 * 1024) throw Error();
  }
  console.log('Artifact storage guard passed. No deletion or billing changes.');
} catch { console.error('Artifact storage guard refused unknown or excessive usage. No raw errors logged.'); process.exitCode = 1; }

import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { guardPublication, inspectSnapshot, baselineApprovalDigest, FILES, REPOSITORY, SITE } from '../scripts/lib/publish-guard.mjs';
import { exportState, restoreState } from '../scripts/lib/update-state.mjs';
import { checkpointFixture, CHECKPOINT_NOW } from './fixtures/checkpoint.js';
import { catalogFixture } from './fixtures/stock-catalog.js';

const now = CHECKPOINT_NOW, commit = 'a'.repeat(40);
const base = resolve('.cache/test-results/publication-guard');
let root, published, manifest, api, reads;
const stringify = JSON.stringify;
const path = name => join(root, 'dist/data', `${name}.json`);
const oldRun = { id: 111, head_sha: commit, head_branch: 'main', run_attempt: 1,
  status: 'completed', conclusion: 'success', event: 'schedule', path: '.github/workflows/data-update.yml' };
function seal() {
  manifest = { version: 1, repository: REPOSITORY, commit, runId: 111, runAttempt: 1,
    createdAt: '2026-10-20T11:30:00.000Z', files: Object.fromEntries(FILES.map(name => [`${name}.json`, inspectSnapshot(name, published[`data/${name}.json`], now)])) };
  published['release-manifest.json'] = stringify(manifest);
}
function run(bootstrap) {
  return guardPublication({ directory: join(root, 'dist'), api, readPublished: reads, bootstrap, now,
    identity: { repository: REPOSITORY, commit: 'b'.repeat(40), runId: 222, runAttempt: 1 } });
}
async function candidate(name, change) {
  const data = JSON.parse(await readFile(path(name), 'utf8')); change(data); await writeFile(path(name), stringify(data));
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Real network forbidden'); }));
  await mkdir(base, { recursive: true }); root = await mkdtemp(join(base, 'case-'));
  await mkdir(join(root, 'dist/data'), { recursive: true }); published = {};
  for (const name of FILES) {
    const text = stringify(name === 'stocks' ? catalogFixture() : checkpointFixture(name));
    published[`data/${name}.json`] = text; await writeFile(path(name), text);
  }
  seal();
  reads = vi.fn(async name => { if (!Object.hasOwn(published, name)) throw Error('Missing fixture'); return published[name]; });
  api = vi.fn(async endpoint => {
    if (endpoint.endsWith('/deployments?environment=github-pages&per_page=1')) return [{ id: 7, sha: commit, environment: 'github-pages' }];
    if (endpoint.endsWith('/deployments/7/statuses?per_page=1')) return [{ state: 'success', environment: 'github-pages', environment_url: SITE,
      log_url: `https://github.com/${REPOSITORY}/actions/runs/111` }];
    if (endpoint.endsWith('/actions/runs/111')) return { ...oldRun };
    if (endpoint.endsWith('/actions/runs/111/attempts/1/jobs?per_page=100')) return { total_count: 3, jobs: [
      { name: 'update', conclusion: 'success' }, { name: 'deploy', conclusion: 'success' }, { name: 'checkpoint', conclusion: 'success' },
    ] };
    throw Error('Unexpected fixture endpoint');
  });
});
afterEach(async () => {
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.useRealTimers();
  if (!resolve(root).startsWith(base + sep)) throw Error('Unsafe cleanup'); await rm(root, { recursive: true });
});
it('allows new validated news with unchanged quotes and seals exactly five public hashes', async () => {
  await candidate('news', data => { data.fetchedAt = '2026-10-20T12:00:00.000Z'; data.articles[0].title = 'Synthetic new story'; });
  const result = await run(), next = JSON.parse(await readFile(join(root, 'dist/release-manifest.json')));
  expect(next.files).toEqual(result.files); expect(Object.keys(next.files)).toHaveLength(5);
  expect(next.runId).toBe(222); expect(next.files['quotes.json']).toEqual(manifest.files['quotes.json']);
  expect(next.files['news.json'].sha256).not.toBe(manifest.files['news.json'].sha256);
  expect(next).not.toHaveProperty('status'); expect(api).toHaveBeenCalledTimes(8);
});
it('a valid but older checkpoint cannot authorize publication over newer live news', async () => {
  await mkdir(join(root, 'public/data'), { recursive: true }); await mkdir(join(root, '.cache/data-updates'), { recursive: true });
  for (const name of FILES.filter(name => name !== 'stocks')) await writeFile(join(root, `public/data/${name}.json`), await readFile(path(name)));
  await writeFile(join(root, '.cache/data-updates/status.json'), stringify({ version: 1, sources: {} }));
  const archive = join(root, 'archive'); await exportState(root, archive, commit);
  expect((await restoreState(root, archive, now, { exact: true, expectedCommit: commit })).version).toBe(2);
  const news = JSON.parse(published['data/news.json']); news.fetchedAt = '2026-10-20T12:00:00.000Z';
  published['data/news.json'] = stringify(news); seal();
  await expect(run()).rejects.toThrow();
});
it('rejects one regressing source even when other candidate snapshots are newer', async () => {
  await candidate('news', data => { data.fetchedAt = '2026-10-20T12:00:00.000Z'; });
  await candidate('quotes', data => { data.tradeDate = '2026-10-15'; data.quotes.forEach(quote => { quote.date = data.tradeDate; }); });
  await expect(run()).rejects.toThrow();
});
it.each(['missing', 'schema', 'sha256', 'manifest', 'provenance', 'cdn-old-manifest', 'cdn-mixed-json', 'time-regression'])('fails closed for %s baseline/candidate', async fault => {
  if (fault === 'missing') delete published['data/news.json'];
  if (fault === 'schema') published['data/news.json'] = '{}';
  if (fault === 'sha256') { manifest.files['news.json'].sha256 = '0'.repeat(64); published['release-manifest.json'] = stringify(manifest); }
  if (fault === 'manifest') { manifest.version = 99; published['release-manifest.json'] = stringify(manifest); }
  if (fault === 'provenance') { manifest.commit = 'c'.repeat(40); published['release-manifest.json'] = stringify(manifest); }
  if (fault === 'cdn-old-manifest') { manifest.runId = 110; published['release-manifest.json'] = stringify(manifest); }
  if (fault === 'cdn-mixed-json') { const news = JSON.parse(published['data/news.json']); news.articles[0].title = 'Other cached deployment'; published['data/news.json'] = stringify(news); }
  if (fault === 'time-regression') await candidate('quotes', data => { data.fetchedAt = '2026-10-20T10:00:00Z'; });
  await expect(run()).rejects.toThrow();
  await expect(readFile(join(root, 'dist/release-manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it.each(['api', 'website', 'missing-initial-manifest'])('has no fallback when %s cannot establish a baseline', async fault => {
  if (fault === 'api') api.mockRejectedValue(Error('Simulated API failure'));
  if (fault === 'website') reads.mockRejectedValue(Error('Simulated HTTP failure'));
  if (fault === 'missing-initial-manifest') delete published['release-manifest.json'];
  await expect(run()).rejects.toThrow();
});
it.each(['failure', 'in_progress', 'pending', 'inactive'])('rejects latest deployment status %s rather than using an older success', async state => {
  const original = api.getMockImplementation(); api.mockImplementation(async endpoint => endpoint.includes('/statuses?')
    ? [{ state, environment: 'github-pages', environment_url: SITE }] : original(endpoint));
  await expect(run()).rejects.toThrow();
});
it('refuses a green source-update run whose deploy was skipped', async () => {
  const original = api.getMockImplementation(); api.mockImplementation(async endpoint => endpoint.includes('/jobs?')
    ? { total_count: 1, jobs: [{ name: 'deploy', conclusion: 'skipped' }] } : original(endpoint));
  await expect(run()).rejects.toThrow();
});
it('refuses a changed deployment between metadata reads', async () => {
  const original = api.getMockImplementation(); let count = 0;
  api.mockImplementation(async endpoint => {
    const value = await original(endpoint);
    if (endpoint.includes('/deployments?') && ++count === 2) return [{ ...value[0], id: 8 }];
    return value;
  });
  await expect(run()).rejects.toThrow();
});
it('refuses a changed manifest during the read window', async () => {
  const original = reads.getMockImplementation(); let count = 0;
  reads.mockImplementation(async name => name === 'release-manifest.json' && ++count === 2 ? stringify({ ...manifest, runId: 333 }) : original(name));
  await expect(run()).rejects.toThrow();
});
it('catalog changes and same-time different contents need separate review, not a market-update release', async () => {
  await candidate('stocks', data => { data.stocks[0].name = 'Synthetic catalog change'; });
  await expect(run()).rejects.toThrow();
  await writeFile(path('stocks'), published['data/stocks.json']);
  await candidate('news', data => { data.articles[0].title = 'Unproven same-time revision'; });
  await expect(run()).rejects.toThrow();
});
it('uses Taipei calendar dates for date-only data just after midnight', () => {
  const data = checkpointFixture('horoscope');
  data.fetchedAt = '2026-10-20T16:05:00.000Z'; data.readings.forEach(reading => { reading.date = '2026-10-21'; });
  expect(inspectSnapshot('horoscope', stringify(data), Date.parse('2026-10-20T16:06:00Z')).sourceDate).toBe('2026-10-21');
});
it('both workflows hold the same non-cancelling lock throughout compare and deployment', async () => {
  for (const file of ['data-update', 'pages-manual']) {
    const workflow = (await readFile(`.github/workflows/${file}.yml`, 'utf8')).replace(/\r\n/g, '\n');
    expect(workflow).toMatch(/\nconcurrency:\n(?:  #[^\n]*\n)*  group: dailyinfo-production\n  cancel-in-progress: false/);
    expect(workflow.indexOf('node scripts/publish-guard.mjs')).toBeGreaterThan(workflow.indexOf('npm run build'));
    expect(workflow.indexOf('node scripts/publish-guard.mjs')).toBeLessThan(workflow.indexOf('uses: actions/upload-pages-artifact'));
    expect(workflow).not.toContain('continue-on-error:');
    expect(workflow).toContain('deployments: read'); expect(workflow).not.toContain('deployments: write');
    expect(workflow).toContain("vars.DATA_PUBLISH_ENABLED == 'true'"); expect(workflow).toContain("vars.DATA_DEPLOY_TARGET == 'pages'");
  }
});
it('manual Pages cannot bypass the guard with repository JSON or skip failed build checks', async () => {
  const workflow = await readFile('.github/workflows/pages-manual.yml', 'utf8');
  expect(workflow.indexOf('npm test')).toBeLessThan(workflow.indexOf('node scripts/publish-guard.mjs'));
  expect(workflow.indexOf('npm run verify -- --dist')).toBeLessThan(workflow.indexOf('node scripts/publish-guard.mjs'));
  expect(workflow).toContain('needs: build'); expect(workflow).not.toContain('always()');
  await candidate('news', data => { data.fetchedAt = '2026-10-20T10:00:00.000Z'; });
  await expect(run()).rejects.toThrow();
});

function bootstrapApproval(change = () => {}) {
  const approval = { version: 1, repository: REPOSITORY,
    baseline: { deploymentId: 7, commit, runId: 111, runAttempt: 1 },
    verifiedAt: manifest.createdAt, expiresAt: '2026-10-27T11:30:00.000Z', files: manifest.files,
    evidence: { pagesArtifactId: 8, pagesArtifactDigest: 'sha256:' + 'c'.repeat(64),
      checkpointArtifactId: 9, checkpointArtifactDigest: 'sha256:' + 'd'.repeat(64) } };
  change(approval);
  const approvalText = stringify(approval);
  return { approvalText, env: { INITIALIZE_MANIFEST: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/data-update.yml@refs/heads/main`,
    CHECKPOINT_ONLY: 'true', INITIALIZE_STATE: 'false', PUBLISH_CURRENT: 'true', APPROVED_CHECKPOINT_RUN: '111',
    AUTOMATION: 'true', FREE: 'true', SCHEDULE: 'false', PUBLISH: 'true', DEPLOY_TARGET: 'pages',
    BASELINE_APPROVAL: 'sha256:' + createHash('sha256').update(approvalText).digest('hex') } };
}
function missingManifest() {
  delete published['release-manifest.json'];
  const original = reads.getMockImplementation();
  reads.mockImplementation(async name => {
    if (name === 'release-manifest.json' && !Object.hasOwn(published, name)) {
      throw Object.assign(Error('Synthetic 404'), { safeCode: 'release_manifest_missing' });
    }
    return original(name);
  });
}
it('adopts only the reviewed, byte-identical deployment on explicit manual approval, then forbids initialization replay', async () => {
  const approval = bootstrapApproval(); missingManifest();
  expect(baselineApprovalDigest(JSON.stringify(JSON.parse(approval.approvalText), null, 2) + '\r\n')).toBe(approval.env.BASELINE_APPROVAL);
  await expect(guardPublication({ directory: join(root, 'dist'), api, readPublished: reads, bootstrap: approval, now,
    identity: { repository: REPOSITORY, commit: 'b'.repeat(40), runId: 222, runAttempt: 2 } })).rejects.toThrow();
  const result = await run(approval), next = JSON.parse(await readFile(join(root, 'dist/release-manifest.json')));
  expect(result.initialized).toBe(true); expect(next.files).toEqual(manifest.files);
  expect(next.commit).toBe('b'.repeat(40)); expect(next.runId).toBe(222);
  published['release-manifest.json'] = stringify(next);
  await expect(run(approval)).rejects.toThrow();
});
it.each([
  ['INITIALIZE_MANIFEST', undefined], ['INITIALIZE_MANIFEST', 'false'], ['GITHUB_EVENT_NAME', 'schedule'],
  ['GITHUB_REF', 'refs/heads/feature'], ['GITHUB_WORKFLOW_REF', `${REPOSITORY}/.github/workflows/pages-manual.yml@refs/heads/main`],
  ['CHECKPOINT_ONLY', 'false'], ['INITIALIZE_STATE', 'true'], ['PUBLISH_CURRENT', 'false'],
  ['APPROVED_CHECKPOINT_RUN', '999'], ['AUTOMATION', 'false'], ['FREE', undefined], ['SCHEDULE', 'true'],
  ['PUBLISH', 'false'], ['DEPLOY_TARGET', 'other'], ['AUTO_PUBLISH', 'true'], ['BASELINE_APPROVAL', 'sha256:' + '0'.repeat(64)],
])('first initialization refuses unsafe %s=%s without sealing a manifest', async (key, value) => {
  const approval = bootstrapApproval(); approval.env[key] = value; missingManifest();
  await expect(run(approval)).rejects.toThrow();
  await expect(readFile(join(root, 'dist/release-manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it.each(['expired', 'deployment', 'checksum', 'schema'])('refuses %s bootstrap evidence even if its approval digest matches', async fault => {
  const approval = bootstrapApproval(a => {
    if (fault === 'expired') a.expiresAt = '2026-10-20T11:00:00Z';
    if (fault === 'deployment') a.baseline.deploymentId = 99;
    if (fault === 'checksum') a.files['news.json'] = { ...a.files['news.json'], sha256: '0'.repeat(64) };
    if (fault === 'schema') a.files['news.json'] = {};
  });
  missingManifest(); await expect(run(approval)).rejects.toThrow();
});
it('bootstrap never treats HTTP/API failure or malformed existing manifest as first-use absence', async () => {
  const approval = bootstrapApproval();
  reads.mockRejectedValueOnce(Error('Synthetic 403'));
  await expect(run(approval)).rejects.toThrow();
  published['release-manifest.json'] = '{}'; await expect(run(approval)).rejects.toThrow();
});
it('initial adoption cannot combine new candidate data or mixed-CDN published bytes with baseline setup', async () => {
  const approval = bootstrapApproval(); missingManifest();
  await candidate('news', data => { data.fetchedAt = '2026-10-20T12:00:00.000Z'; data.articles[0].title = 'Unapproved new first-release data'; });
  await expect(run(approval)).rejects.toThrow();
  await writeFile(path('news'), published['data/news.json']);
  published['data/news.json'] += ' '; await expect(run(approval)).rejects.toThrow();
});
it('a manifest appearing between checks causes initialization to stop', async () => {
  const approval = bootstrapApproval(); missingManifest(); const original = reads.getMockImplementation(); let count = 0;
  reads.mockImplementation(async name => name === 'release-manifest.json' && ++count === 2 ? stringify(manifest) : original(name));
  await expect(run(approval)).rejects.toThrow();
});
it('bootstrap inputs are inert by default and checked before restore or any data request; manual Pages has no initialization entry', async () => {
  const workflow = await readFile('.github/workflows/data-update.yml', 'utf8');
  expect(workflow).toMatch(/initialize_manifest:[\s\S]*?default: false/);
  expect(workflow.indexOf('node scripts/authorize-release-baseline.mjs')).toBeLessThan(workflow.indexOf('name: Restore last successful checkpoint'));
  expect(workflow.indexOf('node scripts/authorize-release-baseline.mjs')).toBeLessThan(workflow.indexOf('name: Isolated source updates'));
  expect(workflow).toContain('BASELINE_APPROVAL: ${{ inputs.baseline_approval }}');
  const manual = await readFile('.github/workflows/pages-manual.yml', 'utf8');
  expect(manual).not.toContain('initialize_manifest:');
  const cli = await readFile('scripts/publish-guard.mjs', 'utf8');
  expect(cli).toContain("path === 'release-manifest.json' && response.status === 404");
  expect(cli).not.toContain('actions/variables');
});

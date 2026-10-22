import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { validateCatalog } from '../../src/services/stock-catalog.js';
import { taipeiDate } from '../../src/services/horoscope.js';
import { validateData, sourceDate } from './data-automation.mjs';
import { assertPublishableText } from './deployment-check.mjs';

export const REPOSITORY = 'Duke11111/dailyinfo';
export const SITE = 'https://duke11111.github.io/dailyinfo/';
export const FILES = Object.freeze(['stocks', 'quotes', 'news', 'earthquakes', 'horoscope']);
const sha = text => createHash('sha256').update(text).digest('hex');
const fail = () => { throw Error('publication_baseline_unverified'); };
const integer = n => Number.isSafeInteger(n) && n > 0;
const date = text => typeof text === 'string' && Number.isFinite(Date.parse(text));
const commit = text => typeof text === 'string' && /^[a-f0-9]{40}$/.test(text);
export function inspectSnapshot(name, text, now = Date.now()) {
  assertPublishableText(text);
  const raw = JSON.parse(text), data = name === 'stocks' ? validateCatalog(raw) : validateData(name, raw, now);
  const effective = name === 'stocks' ? data.sources.flatMap(source => source.issuedDates).sort().at(-1) : sourceDate(name, data);
  if (!date(data.fetchedAt) || Date.parse(data.fetchedAt) > now + 300000 || !date(effective)
    || (/^\d{4}-\d{2}-\d{2}$/.test(effective) ? effective > taipeiDate(now) : Date.parse(effective) > now + 300000)) fail();
  return { sha256: sha(text), sourceDate: effective, fetchedAt: data.fetchedAt };
}
function exactKeys(object, keys) {
  return object && !Array.isArray(object) && Object.keys(object).sort().join(',') === [...keys].sort().join(',');
}
export function validateReleaseManifest(raw, baseline, now = Date.now()) {
  assertPublishableText(JSON.stringify(raw));
  if (!exactKeys(raw, ['version', 'repository', 'commit', 'runId', 'runAttempt', 'createdAt', 'files'])
    || raw.version !== 1 || raw.repository !== REPOSITORY || !commit(raw.commit) || !integer(raw.runId) || !integer(raw.runAttempt)
    || !date(raw.createdAt) || Date.parse(raw.createdAt) > now + 300000
    || raw.commit !== baseline.commit || raw.runId !== baseline.runId || raw.runAttempt !== baseline.runAttempt
    || !exactKeys(raw.files, FILES.map(name => `${name}.json`))) fail();
  for (const value of Object.values(raw.files)) {
    if (!exactKeys(value, ['sha256', 'sourceDate', 'fetchedAt']) || !/^[a-f0-9]{64}$/.test(value.sha256)
      || !date(value.sourceDate) || !date(value.fetchedAt)) fail();
  }
  return raw;
}
export function assertNoRegression(candidate, published) {
  for (const name of FILES) {
    const next = candidate[`${name}.json`], old = published[`${name}.json`];
    if (!next || !old || next.sourceDate < old.sourceDate || Date.parse(next.fetchedAt) < Date.parse(old.fetchedAt)) fail();
    // Catalog changes require a separate reviewed code change, never an automatic market-data update.
    if (name === 'stocks' && next.sha256 !== old.sha256) fail();
    // Different content with no newer acquisition evidence is ambiguous, not a proven new release.
    if (next.sha256 !== old.sha256 && Date.parse(next.fetchedAt) <= Date.parse(old.fetchedAt)) fail();
  }
}

// Explicit manual approval of a previously verified deployment, never trust a missing manifest alone.
export const baselineApprovalDigest = approvalText => `sha256:${sha(JSON.stringify(JSON.parse(approvalText)))}`;
export function bootstrapManifest({ approvalText, env, identity, baseline, now = Date.now() }) {
  const absent = value => value === undefined || value === '';
  if (env.INITIALIZE_MANIFEST !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_WORKFLOW_REF !== `${REPOSITORY}/.github/workflows/data-update.yml@refs/heads/main`
    || identity.repository !== REPOSITORY || !commit(identity.commit) || identity.runAttempt !== 1 || !integer(identity.runId)
    || env.CHECKPOINT_ONLY !== 'true' || env.INITIALIZE_STATE !== 'false' || env.PUBLISH_CURRENT !== 'true'
    || env.AUTOMATION !== 'true' || env.FREE !== 'true' || env.SCHEDULE !== 'false'
    || env.PUBLISH !== 'true' || env.DEPLOY_TARGET !== 'pages' || !absent(env.AUTO_PUBLISH)
    || env.BASELINE_APPROVAL !== baselineApprovalDigest(approvalText)) fail();
  assertPublishableText(approvalText);
  const approval = JSON.parse(approvalText);
  if (!exactKeys(approval, ['version', 'repository', 'baseline', 'verifiedAt', 'expiresAt', 'files', 'evidence'])
    || approval.version !== 1 || approval.repository !== REPOSITORY
    || !exactKeys(approval.baseline, ['deploymentId', 'commit', 'runId', 'runAttempt'])
    || !integer(approval.baseline.deploymentId) || !date(approval.verifiedAt) || !date(approval.expiresAt)
    || Date.parse(approval.verifiedAt) > now || Date.parse(approval.expiresAt) <= now
    || Date.parse(approval.expiresAt) - Date.parse(approval.verifiedAt) > 7 * 86400000
    || Object.keys(approval.baseline).some(key => approval.baseline[key] !== baseline[key])
    || env.APPROVED_CHECKPOINT_RUN !== String(approval.baseline.runId)
    || !exactKeys(approval.evidence, ['pagesArtifactId', 'pagesArtifactDigest', 'checkpointArtifactId', 'checkpointArtifactDigest'])
    || !integer(approval.evidence.pagesArtifactId) || !integer(approval.evidence.checkpointArtifactId)
    || !/^sha256:[a-f0-9]{64}$/.test(approval.evidence.pagesArtifactDigest)
    || !/^sha256:[a-f0-9]{64}$/.test(approval.evidence.checkpointArtifactDigest)) fail();
  return validateReleaseManifest({ version: 1, repository: REPOSITORY, commit: approval.baseline.commit,
    runId: approval.baseline.runId, runAttempt: approval.baseline.runAttempt,
    createdAt: approval.verifiedAt, files: approval.files }, baseline, now);
}

// Read the authoritative latest deployment, not merely the most recent green workflow.
// Unknown, failed, pending or foreign deployments block publication rather than falling back.
export async function deploymentBaseline(api) {
  const deployments = await api(`repos/${REPOSITORY}/deployments?environment=github-pages&per_page=1`);
  const deployment = deployments?.[0];
  if (!Array.isArray(deployments) || deployments.length !== 1 || !integer(deployment?.id)
    || deployment.environment !== 'github-pages' || !commit(deployment.sha)) fail();
  const statuses = await api(`repos/${REPOSITORY}/deployments/${deployment.id}/statuses?per_page=1`);
  const status = statuses?.[0];
  if (!Array.isArray(statuses) || !status || status.state !== 'success'
    || status.environment !== 'github-pages' || status.environment_url?.toLowerCase() !== SITE) fail();
  const match = typeof status.log_url === 'string'
    && status.log_url.match(/^https:\/\/github\.com\/Duke11111\/dailyinfo\/actions\/runs\/([1-9]\d*)(?:\/job\/[1-9]\d*)?$/);
  if (!match) fail();
  const run = await api(`repos/${REPOSITORY}/actions/runs/${match[1]}`);
  if (!integer(run.id) || String(run.id) !== match[1] || run.head_branch !== 'main' || run.head_sha !== deployment.sha
    || run.status !== 'completed' || run.conclusion !== 'success' || !integer(run.run_attempt)
    || !['schedule', 'workflow_dispatch'].includes(run.event)
    || !['.github/workflows/data-update.yml', '.github/workflows/pages-manual.yml'].includes(run.path)) fail();
  const jobs = await api(`repos/${REPOSITORY}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  if (!Array.isArray(jobs.jobs) || jobs.total_count !== jobs.jobs.length
    || jobs.jobs.filter(job => job.name === 'deploy' && job.conclusion === 'success').length !== 1) fail();
  return { deploymentId: deployment.id, commit: run.head_sha, runId: run.id, runAttempt: run.run_attempt };
}

export async function guardPublication({ directory, api, readPublished, identity, bootstrap, now = Date.now() }) {
  if (identity.repository !== REPOSITORY || !commit(identity.commit) || !integer(identity.runId)
    || !integer(identity.runAttempt)) fail();
  // An old manifest from a CDN cannot authenticate as the latest successful GitHub deployment.
  const baseline = await deploymentBaseline(api);
  let manifestText, manifest, initialized = false;
  try { manifestText = await readPublished('release-manifest.json'); }
  catch (error) {
    if (error.safeCode !== 'release_manifest_missing' || !bootstrap) fail();
    manifest = bootstrapManifest({ ...bootstrap, baseline, identity, now }); initialized = true;
  }
  if (!initialized) {
    if (bootstrap) fail(); // Initialization cannot be replayed after a public manifest exists.
    manifest = validateReleaseManifest(JSON.parse(manifestText), baseline, now);
  }
  const candidate = {};
  for (const name of FILES) {
    const filename = `${name}.json`, live = inspectSnapshot(name, await readPublished(`data/${filename}`), now);
    // Compare fields independently of JSON property order in a valid external manifest.
    if (Object.keys(live).some(key => live[key] !== manifest.files[filename][key])) fail();
    candidate[filename] = inspectSnapshot(name, await readFile(join(directory, 'data', filename), 'utf8'), now);
  }
  assertNoRegression(candidate, manifest.files);
  // First adoption changes code/provenance only; data must match the explicitly reviewed baseline.
  if (initialized && FILES.some(name => candidate[`${name}.json`].sha256 !== manifest.files[`${name}.json`].sha256)) fail();
  const again = await deploymentBaseline(api);
  if (JSON.stringify(again) !== JSON.stringify(baseline)) fail();
  if (initialized) {
    try { await readPublished('release-manifest.json'); fail(); }
    catch (error) { if (error.safeCode !== 'release_manifest_missing') fail(); }
    bootstrapManifest({ ...bootstrap, baseline: again, identity, now });
  } else if (await readPublished('release-manifest.json') !== manifestText) fail();
  // The public manifest contains public provenance and hashes only, never internal state or credentials.
  const next = { version: 1, repository: REPOSITORY, commit: identity.commit, runId: identity.runId,
    runAttempt: identity.runAttempt, createdAt: new Date(now).toISOString(), files: candidate };
  const nextText = JSON.stringify(next, null, 2) + '\n';
  assertPublishableText(nextText);
  // Keep the same conservative build-size ceiling as the existing Artifact guard.
  async function size(dir) {
    let total = 0;
    for (const name of await readdir(dir)) {
      const path = join(dir, name), stat = await lstat(path);
      if (stat.isSymbolicLink()) fail();
      total += stat.isDirectory() ? await size(path) : stat.size;
    }
    return total;
  }
  if (await size(directory) + Buffer.byteLength(nextText) > 8 * 1024 * 1024) fail();
  await writeFile(join(directory, 'release-manifest.json'), nextText);
  return { baseline, files: candidate, initialized };
}

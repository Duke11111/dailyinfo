import { createHash } from 'node:crypto';
import { SOURCES, validateData, validateState, sourceDate, contentDigest } from './data-automation.mjs';
import { scheduleDecision } from './source-schedule.mjs';
import { updateSummary } from './update-summary.mjs';
import { assertPublishableText } from './deployment-check.mjs';
export const D4_CRON = '43 12 * * *';
export const D4_FILES = ['stocks', ...SOURCES];
export const hash = text => createHash('sha256').update(text).digest('hex');
const reject = () => { throw Error('d4_refused'); };
const integer = n => Number.isSafeInteger(n) && n > 0;
// GitHub vars maps an unset value to an empty string; never coerce other inputs.
export function d4SwitchesSafe(env) {
  const absent = value => value === undefined || value === '';
  return env?.AUTOMATION === 'true' && env.SCHEDULE === 'true' && env.FREE === 'true'
    && env.PUBLISH === 'false' && absent(env.AUTO_PUBLISH) && absent(env.DEPLOY_TARGET);
}
export function d4Config(raw) {
  const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!c || c.version !== 1 || !/^d4-[0-9]{8}-evening$/.test(c.id ?? '') || !/^[a-f0-9]{40}$/.test(c.expectedSha ?? '')
    || !/^\d{4}-\d{2}-\d{2}T20:43:00\+08:00$/.test(c.target ?? '')
    || !Number.isFinite(Date.parse(c.target)) || !Number.isFinite(Date.parse(c.deadline))
    || new Date(Date.parse(c.target) + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '') !== c.id.slice(3, 11)
    || Date.parse(c.deadline) - Date.parse(c.target) !== 47 * 60000
    || !integer(c.checkpoint?.runId) || !integer(c.checkpoint?.artifactId) || !/^[a-f0-9]{40}$/.test(c.checkpoint?.commit ?? '')
    || !/^sha256:[a-f0-9]{64}$/.test(c.checkpoint?.digest ?? '') || !integer(c.deploymentId)
    || !c.published || Object.keys(c.published).sort().join() !== [...D4_FILES].sort().join()
    || Object.values(c.published).some(value => !/^[a-f0-9]{64}$/.test(value))) reject();
  assertPublishableText(JSON.stringify(c)); return c;
}
export function admitD4(c, env, { runs, artifacts, now = Date.now() }) {
  d4Config(c);
  assertD4StartWindow(c, now);
  if (env.GITHUB_EVENT_NAME !== 'schedule' || env.SCHEDULE_CRON !== D4_CRON || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_SHA !== c.expectedSha || env.GITHUB_REPOSITORY !== 'Duke11111/dailyinfo'
    || env.GITHUB_RUN_ATTEMPT !== '1' || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '')
    || !d4SwitchesSafe(env)
    || !Array.isArray(runs) || !Array.isArray(artifacts)) reject();
  const current = runs.find(run => String(run.id) === env.GITHUB_RUN_ID);
  const eligible = run => run.event === 'schedule' && run.head_branch === 'main' && run.head_sha === c.expectedSha
    && run.path === '.github/workflows/data-update.yml';
  if (runs.some(run => !integer(run.id) || !Number.isFinite(Date.parse(run.created_at)))
    || !current || !eligible(current) || !Number.isFinite(Date.parse(current.created_at))
    || Date.parse(current.created_at) < Date.parse(c.target) || Date.parse(current.created_at) > now
    || runs.some(run => String(run.id) !== env.GITHUB_RUN_ID && eligible(run)
      && Date.parse(run.created_at) >= Date.parse(c.target) && Date.parse(run.created_at) <= Date.parse(c.deadline))
    || artifacts.some(item => item.name === c.id + '-claim')) reject();
  return { version: 1, id: c.id, runId: Number(env.GITHUB_RUN_ID), commit: c.expectedSha, deadline: c.deadline };
}
export function assertD4StartWindow(c, now = Date.now()) {
  if (!Number.isFinite(now) || now < Date.parse(c.target) || now > Date.parse(c.deadline) - 20 * 60000) reject();
}
export function assertD4Checkpoint(c, selected) {
  if (!selected || selected.id !== c.checkpoint.artifactId || selected.workflow_run?.id !== c.checkpoint.runId
    || selected.verifiedHeadSha !== c.checkpoint.commit || selected.digest !== c.checkpoint.digest) reject();
}
export function snapshotFacts(source, text, now = Date.now()) {
  const data = validateData(source, JSON.parse(text), now);
  return { sha256: hash(text), content: contentDigest(data), sourceDate: sourceDate(source, data), fetchedAt: data.fetchedAt };
}
export function acceptanceReport({ config, env, jobs, report, before, after, manifest, artifact, publicUnchanged, now = Date.now() }) {
  const checks = {};
  checks.event = env.GITHUB_EVENT_NAME === 'schedule' && env.SCHEDULE_CRON === D4_CRON && env.GITHUB_SHA === config.expectedSha
    && env.GITHUB_RUN_ATTEMPT === '1' && env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_REPOSITORY === 'Duke11111/dailyinfo';
  checks.publicationDisabled = env.PUBLISH === 'false' && !env.AUTO_PUBLISH && !env.DEPLOY_TARGET;
  checks.safetySwitches = d4SwitchesSafe(env);
  checks.deadline = now >= Date.parse(config.target) && now <= Date.parse(config.deadline)
    && Date.parse(report?.startedAt) >= Date.parse(config.target) && Date.parse(report?.startedAt) <= now;
  checks.jobs = jobs.update === 'success' && jobs.deploy === 'skipped' && jobs.checkpoint === 'success';
  checks.publicUnchanged = publicUnchanged === true;
  checks.checkpoint = manifest?.version === 2 && manifest.commit === config.expectedSha && integer(artifact?.id)
    && artifact.expired === false && Date.parse(artifact.expires_at) > now
    && artifact.workflow_run?.id === Number(env.GITHUB_RUN_ID)
    && Object.keys(manifest.hashes ?? {}).sort().join() === [...SOURCES.map(name => name + '.json'), 'status.json'].sort().join()
    && Object.values(manifest.hashes).every(value => /^[a-f0-9]{64}$/.test(value))
    && SOURCES.every(source => manifest.hashes[source + '.json'] === after[source]?.sha256);
  let safeSummary = '', valid = false;
  try {
    safeSummary = updateSummary(report); validateState(before.state, now);
    valid = report.results.length === SOURCES.length && new Set(report.results.map(item => item.source)).size === SOURCES.length
      && report.failed === 0 && report.results.every(item => {
        const old = before.files[item.source], next = after[item.source];
        if (!old || !next || next.sourceDate < old.sourceDate || Date.parse(next.fetchedAt) < Date.parse(old.fetchedAt)
          || item.sourceDate !== next.sourceDate || item.fetchedAt !== next.fetchedAt || item.status === 'failed') return false;
        if (item.status === 'skipped') return item.code === 'not_due' && old.sha256 === next.sha256
          && scheduleDecision(item.source, before.state, Date.parse(report.startedAt), { cron: D4_CRON }).due === false;
        if (!['updated', 'unchanged'].includes(item.status) || !['ok', 'source_delayed'].includes(item.code)) return false;
        if (item.status === 'updated' ? old.content === next.content : old.sha256 !== next.sha256) return false;
        return true;
      }) && report.changed === report.results.some(item => item.status === 'updated');
  } catch { valid = false; }
  checks.sourcesAndDates = valid;
  const pass = Object.values(checks).every(Boolean);
  const summary = `## D4 acceptance: ${pass ? 'PASS' : 'FAIL'}\n\n` + Object.entries(checks).map(([key, value]) => `- ${key}: ${value ? 'PASS' : 'FAIL'}`).join('\n')
    + `\n\nCheckpoint artifact: ${integer(artifact?.id) ? artifact.id : 'unverified'}; expires: ${Number.isFinite(Date.parse(artifact?.expires_at)) ? new Date(artifact.expires_at).toISOString() : 'unverified'}\n\n`
    + safeSummary + '\nTime expiry does NOT turn off Repository Variables. This report does not authorize publication or retries.\n';
  assertPublishableText(summary); return { pass, checks, summary };
}

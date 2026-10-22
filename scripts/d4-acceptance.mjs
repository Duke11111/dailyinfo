import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { d4Config, d4SwitchesSafe, admitD4, assertD4StartWindow, D4_FILES, hash, snapshotFacts, acceptanceReport } from './lib/d4-acceptance.mjs';
import { SOURCES, validateState } from './lib/data-automation.mjs';
import { restoreState } from './lib/update-state.mjs';
import { validateCatalog } from '../src/services/stock-catalog.js';
import { updateSummary } from './lib/update-summary.mjs';
const repository = 'Duke11111/dailyinfo', directory = '.cache/d4';
const gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 20000, maxBuffer: 2097152, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const api = path => JSON.parse(gh(['api', `repos/${repository}/${path}`]));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
async function summary(text) { if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text); }
async function publicBaseline(config) {
  // Workflow vars context snapshot only; this is NOT a live Variables API read.
  if (!d4SwitchesSafe(process.env)) throw Error();
  if (api('commits/main').sha !== config.expectedSha) throw Error();
  for (const status of ['in_progress', 'queued']) {
    const runs = api(`actions/runs?status=${status}&per_page=100`);
    if (!Array.isArray(runs.workflow_runs) || runs.total_count !== runs.workflow_runs.length
      || runs.workflow_runs.some(run => String(run.id) !== process.env.GITHUB_RUN_ID)) throw Error();
  }
  const deployment = api('deployments?environment=github-pages&per_page=1')[0];
  const statuses = deployment && api(`deployments/${deployment.id}/statuses?per_page=1`);
  if (deployment?.id !== config.deploymentId || statuses?.[0]?.state !== 'success') throw Error();
  for (const name of D4_FILES) {
    const response = await fetch(`https://duke11111.github.io/dailyinfo/data/${name}.json?d4=${process.env.GITHUB_RUN_ID}`,
      { cache: 'no-store', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Error();
    let length = 0; const chunks = [];
    for await (const chunk of response.body) { length += chunk.length; if (length > 4 * 1024 * 1024) throw Error(); chunks.push(chunk); }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    if (hash(text) !== config.published[name]) throw Error();
    if (name === 'stocks') validateCatalog(JSON.parse(text)); else snapshotFacts(name, text);
  }
  if (api('deployments?environment=github-pages&per_page=1')[0]?.id !== config.deploymentId) throw Error();
  return true;
}
try {
  const config = d4Config(process.env.D4_CONFIG), mode = process.argv[2];
  if (process.env.GITHUB_REPOSITORY !== repository || !d4SwitchesSafe(process.env)) throw Error();
  await mkdir(directory, { recursive: true });
  if (mode === 'admit') {
    const result = api(`actions/workflows/data-update.yml/runs?event=schedule&head_sha=${config.expectedSha}&per_page=100`);
    if (result.total_count > 100 || !Array.isArray(result.workflow_runs)) throw Error();
    const artifacts = api(`actions/artifacts?name=${config.id}-claim&per_page=100`);
    if (artifacts.total_count > 100) throw Error();
    const claim = admitD4(config, process.env, { runs: result.workflow_runs, artifacts: artifacts.artifacts });
    await publicBaseline(config);
    // HTTP/API validation may take time; the first admission check alone is insufficient.
    assertD4StartWindow(config);
    await writeFile(join(directory, 'claim.json'), JSON.stringify(claim));
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `claim_name=${config.id}-claim\n`);
    await summary('## D4 admission: ADMITTED\n\nNot an acceptance PASS. Claim must be persisted before any source update.\n');
  } else if (mode === 'capture') {
    assertD4StartWindow(config);
    const state = validateState(await json('.cache/data-updates/status.json'));
    const files = {};
    for (const source of SOURCES) files[source] = snapshotFacts(source, await readFile(`public/data/${source}.json`, 'utf8'));
    await writeFile(join(directory, 'before.json'), JSON.stringify({ state, files }));
  } else if (mode === 'evidence') {
    const before = await json(join(directory, 'before.json')), report = await json('.cache/data-updates/report.json');
    updateSummary(report);
    const text = JSON.stringify({ before, report }); if (Buffer.byteLength(text) > 32768) throw Error();
    await writeFile(join(directory, 'evidence.json'), text);
  } else if (mode === 'verify') {
    const jobs = { update: process.env.UPDATE_RESULT, deploy: process.env.DEPLOY_RESULT, checkpoint: process.env.CHECKPOINT_RESULT };
    if (jobs.update !== 'success' || jobs.deploy !== 'skipped' || jobs.checkpoint !== 'success'
      || Date.now() > Date.parse(config.deadline)) throw Error();
    gh(['run', 'download', process.env.GITHUB_RUN_ID, '--repo', repository, '--name', 'dailyinfo-d4-evidence', '--dir', join(directory, 'evidence')]);
    gh(['run', 'download', process.env.GITHUB_RUN_ID, '--repo', repository, '--name', 'dailyinfo-data-state', '--dir', join(directory, 'checkpoint')]);
    const artifacts = api(`actions/runs/${process.env.GITHUB_RUN_ID}/artifacts`).artifacts;
    const artifact = artifacts.find(item => item.name === 'dailyinfo-data-state');
    const manifest = await restoreState(join(directory, 'validated'), join(directory, 'checkpoint'), Date.now(), { exact: true, expectedCommit: config.expectedSha });
    if (manifest.version !== 2) throw Error();
    const evidence = await json(join(directory, 'evidence/evidence.json')), after = {};
    for (const source of SOURCES) after[source] = snapshotFacts(source, await readFile(join(directory, `checkpoint/${source}.json`), 'utf8'));
    const result = acceptanceReport({ config, env: process.env, jobs, ...evidence, after, manifest, artifact, publicUnchanged: await publicBaseline(config) });
    await summary(result.summary); if (!result.pass) process.exitCode = 1;
  } else throw Error();
} catch {
  const result = name => ['success', 'failure', 'cancelled', 'skipped'].includes(process.env[name]) ? process.env[name] : 'unverified';
  await summary(`## D4 acceptance: FAIL\n\n- update: ${result('UPDATE_RESULT')}\n- deploy: ${result('DEPLOY_RESULT')}\n- checkpoint: ${result('CHECKPOINT_RESULT')}\n\n`
    + SOURCES.map(source => `- ${source}: unverified; not accepted\n`).join('')
    + '\nAdmission, evidence, deadline, jobs, checkpoint or public-baseline verification did not complete. No retry, initialization or publication is authorized. Repository Variables were NOT changed automatically.\n');
  console.error('D4 refused or verification incomplete. No raw responses, child output or credentials logged.'); process.exitCode = 1;
}

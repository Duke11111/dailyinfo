import { nowMs } from '../src/lib/time.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECT_ROOT, verifySnapshots } from './lib/data-automation.mjs';
import { exportState, restoreState } from './lib/update-state.mjs';
import { assertCheckpointPublish, selectCheckpoint } from './lib/checkpoint-policy.mjs';
import { d4Config, assertD4Checkpoint } from './lib/d4-acceptance.mjs';
import { scheduledMode } from './lib/schedule-mode.mjs';
const exec = promisify(execFile);
async function gh(args) { const result = await exec('gh', args, { cwd: PROJECT_ROOT, timeout: 30000, maxBuffer: 2097152, windowsHide: true }); return result.stdout; }
async function output(name, value) { if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`); }
try {
  const mode = process.argv[2];
  if (mode === 'export') {
    await exportState(PROJECT_ROOT, join(PROJECT_ROOT, '.cache/data-state'), process.env.GITHUB_SHA || '');
    console.log('Validated data checkpoint prepared.');
  } else if (mode === 'restore') {
    const schedule = process.env.GITHUB_EVENT_NAME === 'schedule' ? scheduledMode(process.env) : null;
    assertCheckpointPublish(process.env);
    const exact = process.env.CHECKPOINT_ONLY === 'true';
    const repository = process.env.GITHUB_REPOSITORY, branch = process.env.DEFAULT_BRANCH;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !branch) throw Error();
    const list = JSON.parse(await gh(['api', `repos/${repository}/actions/artifacts?name=dailyinfo-data-state&per_page=100`]));
    const selected = await selectCheckpoint(list.artifacts, async id => JSON.parse(await gh(['api', `repos/${repository}/actions/runs/${id}`])),
      { branch, exact, approvedRun: process.env.APPROVED_CHECKPOINT_RUN });
    if (schedule === 'd4') assertD4Checkpoint(d4Config(process.env.D4_CONFIG), selected);
    if (!selected) {
      if (exact || process.env.INITIALIZE_STATE !== 'true') throw Error();
      await verifySnapshots(); await output('code_changed', true);
      console.log('Explicit initial checkpoint uses validated repository snapshots.');
    } else {
      const directory = join(PROJECT_ROOT, '.cache/restored-state');
      await gh(['run', 'download', String(selected.workflow_run.id), '--repo', repository, '--name', 'dailyinfo-data-state', '--dir', directory]);
      const manifest = await restoreState(PROJECT_ROOT, directory, nowMs(), { exact, expectedCommit: selected.verifiedHeadSha });
      await output('code_changed', manifest.commit !== process.env.GITHUB_SHA);
      console.log('Last successful validated checkpoint restored.');
      if (exact) console.log('Approved checkpoint restored exactly; no source update or initialization.');
    }
  } else throw Error();
} catch { console.error('Checkpoint operation failed. Refusing unverified or expired state; no credentials or raw errors logged.'); process.exitCode = 1; }

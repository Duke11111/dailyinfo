import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECT_ROOT, verifySnapshots } from './lib/data-automation.mjs';
import { exportState, restoreState } from './lib/update-state.mjs';
const exec = promisify(execFile);
async function gh(args) { const result = await exec('gh', args, { cwd: PROJECT_ROOT, timeout: 30000, maxBuffer: 2097152, windowsHide: true }); return result.stdout; }
async function output(name, value) { if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`); }
try {
  const mode = process.argv[2];
  if (mode === 'export') {
    await exportState(PROJECT_ROOT, join(PROJECT_ROOT, '.cache/data-state'), process.env.GITHUB_SHA || '');
    console.log('Validated data checkpoint prepared.');
  } else if (mode === 'restore') {
    const repository = process.env.GITHUB_REPOSITORY, branch = process.env.DEFAULT_BRANCH;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !branch) throw Error();
    const list = JSON.parse(await gh(['api', `repos/${repository}/actions/artifacts?name=dailyinfo-data-state&per_page=100`]));
    const candidates = list.artifacts.filter(item => !item.expired && item.name === 'dailyinfo-data-state' && item.workflow_run?.head_branch === branch).slice(0, 3);
    let selected;
    for (const candidate of candidates) {
      if (!Number.isSafeInteger(candidate.workflow_run.id)) throw Error();
      const run = JSON.parse(await gh(['api', `repos/${repository}/actions/runs/${candidate.workflow_run.id}`]));
      if (run.path === '.github/workflows/data-update.yml' && ['schedule', 'workflow_dispatch'].includes(run.event) && run.head_branch === branch && run.status === 'completed' && run.conclusion === 'success') { selected = candidate; break; }
    }
    if (!selected) {
      if (process.env.INITIALIZE_STATE !== 'true') throw Error();
      await verifySnapshots(); await output('code_changed', true);
      console.log('Explicit initial checkpoint uses validated repository snapshots.');
    } else {
      const directory = join(PROJECT_ROOT, '.cache/restored-state');
      await gh(['run', 'download', String(selected.workflow_run.id), '--repo', repository, '--name', 'dailyinfo-data-state', '--dir', directory]);
      const manifest = await restoreState(PROJECT_ROOT, directory);
      await output('code_changed', manifest.commit !== process.env.GITHUB_SHA);
      console.log('Last successful validated checkpoint restored.');
    }
  } else throw Error();
} catch { console.error('Checkpoint operation failed. Refusing unverified or expired state; no credentials or raw errors logged.'); process.exitCode = 1; }

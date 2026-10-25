import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECT_ROOT } from './lib/data-automation.mjs';
import { downloadLatestCheckpoint, revalidateCachedCheckpoint, mergeLocalBaseline, baselineFacts } from './lib/local-baseline.mjs';
import { nowMs } from '../src/lib/time.js';
// CI already restores its approved checkpoint and must never acquire a second baseline.
if (process.env.CI || process.env.GITHUB_ACTIONS) {
  console.log('CI uses its existing verified checkpoint policy; no local baseline operation.');
} else {
  try {
    const checkpoint = await downloadLatestCheckpoint(PROJECT_ROOT);
    const choices = await mergeLocalBaseline(PROJECT_ROOT, checkpoint.directory);
    const facts = await baselineFacts(PROJECT_ROOT);
    await mkdir(join(PROJECT_ROOT, '.cache/local-baseline'), { recursive: true });
    await writeFile(join(PROJECT_ROOT, '.cache/local-baseline/latest.json'), JSON.stringify({ checkpoint, choices, facts }, null, 2));
    console.log(JSON.stringify({ checkpointRun: checkpoint.runId, artifactId: checkpoint.artifactId, choices, facts }));
  } catch (error) {
    if (error.code === 'BASELINE_INVALID') { console.error('Checkpoint verification failed; local data preserved, refusing startup/build.'); process.exitCode = 1; }
    else {
    // Only a previously validated, unexpired checkpoint may rescue a network
    // outage. A new worktree must not silently fall back to old Git JSON.
    try {
      const receipt = JSON.parse(await readFile(join(PROJECT_ROOT, '.cache/local-baseline/latest.json'), 'utf8'));
      if (!(Date.parse(receipt.checkpoint.expiresAt) > nowMs())) throw Error();
      const cached = await revalidateCachedCheckpoint(PROJECT_ROOT, receipt.checkpoint);
      await mergeLocalBaseline(PROJECT_ROOT, cached.directory);
      await baselineFacts(PROJECT_ROOT);
      console.warn('Online checkpoint check unavailable. Preserving latest-valid local data against the last verified unexpired baseline; online freshness NOT confirmed.');
    } catch {
      if (process.argv.includes('--allow-git-fallback')) {
        try { await baselineFacts(PROJECT_ROOT); console.warn('Explicit Git/local fallback: validated but NOT confirmed current.'); }
        catch { process.exitCode = 1; }
      } else { console.error('No verified baseline available; local files preserved, refusing startup/build. Restore baseline online first.'); process.exitCode = 1; }
    }
    }
  }
}

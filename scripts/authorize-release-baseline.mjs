import { readFile } from 'node:fs/promises';
import { bootstrapManifest } from './lib/publish-guard.mjs';
// Early refusal before checkpoint restore or source scripts. No API or public-data writes.
try {
  const approvalText = await readFile('data-sources/release-baseline.json', 'utf8');
  bootstrapManifest({ approvalText, env: process.env, baseline: JSON.parse(approvalText).baseline, identity: {
    repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA,
    runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  } });
  console.log('Initial-manifest request authorized; live deployment and data checks remain mandatory.');
} catch {
  console.error('Initial-manifest authorization refused. No raw input, API response or credentials logged.');
  process.exitCode = 1;
}

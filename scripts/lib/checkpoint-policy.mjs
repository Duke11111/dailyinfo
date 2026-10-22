export function assertCheckpointPublish(env) {
  if (env.CHECKPOINT_ONLY !== 'true') return;
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.DEFAULT_BRANCH !== 'main' || env.GITHUB_REF !== 'refs/heads/main'
    || env.INITIALIZE_STATE !== 'false' || env.PUBLISH_CURRENT !== 'true'
    || env.PUBLISH_ENABLED !== 'true' || env.DEPLOY_TARGET !== 'pages'
    || !/^[1-9]\d*$/.test(env.APPROVED_CHECKPOINT_RUN ?? '')) throw Error('checkpoint_publish_not_authorized');
}
export async function selectCheckpoint(artifacts, getRun, { branch, exact = false, approvedRun, now = Date.now() }) {
  const candidates = artifacts.filter(item => !item.expired && item.name === 'dailyinfo-data-state' && item.workflow_run?.head_branch === branch
    && Date.parse(item.expires_at) > now && Date.parse(item.created_at) <= now)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 3);
  for (const candidate of candidates) {
    if (!Number.isSafeInteger(candidate.workflow_run.id)) throw Error('checkpoint_run_invalid');
    const run = await getRun(candidate.workflow_run.id);
    if (run.path === '.github/workflows/data-update.yml' && ['schedule', 'workflow_dispatch'].includes(run.event)
      && run.head_branch === branch && run.status === 'completed' && run.conclusion === 'success') {
      if (exact && String(candidate.workflow_run.id) !== approvedRun) throw Error('checkpoint_approval_changed');
      // Every restore must bind the manifest to a verified source run, not just manual publication.
      if (!/^[a-f0-9]{40}$/.test(run.head_sha ?? '')) throw Error('checkpoint_commit_invalid');
      return { ...candidate, verifiedHeadSha: run.head_sha };
    }
  }
  return null;
}

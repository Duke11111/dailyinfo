export function releaseDecision(env) {
  const dataChanged = env.DATA_CHANGED === 'true';
  const changed = dataChanged || env.CODE_CHANGED === 'true' || env.FORCE_BUILD === 'true';
  const authorized = env.EVENT === 'schedule'
    ? dataChanged && env.AUTO_PUBLISH_ENABLED === 'true' && env.FREE_USAGE_CONFIRMED === 'true'
    : env.EVENT === 'workflow_dispatch' && env.FORCE_BUILD === 'true';
  return { changed, publish: changed && authorized && env.PUBLISH_ENABLED === 'true' && env.DEPLOY_TARGET === 'pages' };
}

// Repository guard is deliberately below Free's shared 500 MB allowance.
// Account-wide Packages/other repositories still require US$0 blocking budgets.
export const ARTIFACT_LIMIT = 180 * 1024 * 1024;
export const UPLOAD_RESERVE = 24 * 1024 * 1024;
export function assertArtifactBudget(artifacts) {
  if (!Array.isArray(artifacts)) throw Error('artifact_budget_invalid');
  let total = 0;
  for (const item of artifacts) {
    if (!Number.isSafeInteger(item.size_in_bytes) || item.size_in_bytes < 0 || typeof item.expired !== 'boolean'
      || !Number.isFinite(Date.parse(item.expires_at))) throw Error('artifact_budget_invalid');
    // Count all reported bytes conservatively, even pending expiration/deletion.
    total += item.size_in_bytes;
  }
  if (total + UPLOAD_RESERVE > ARTIFACT_LIMIT) throw Error('artifact_budget_exceeded');
  return total;
}

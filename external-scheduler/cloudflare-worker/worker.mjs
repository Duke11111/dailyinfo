// No public trigger endpoint, source API access, storage bindings, retries or user input.
export const CRON = '17 0-15 * * *';
const ENDPOINT = 'https://api.github.com/repos/Duke11111/dailyinfo/actions/workflows/data-update.yml/dispatches';
export async function dispatchTick(event, env, { fetchImpl = fetch, now = Date.now } = {}) {
  if (env.ENABLED !== 'true' || env.FREE_USAGE_CONFIRMED !== 'true') return { code: 'disabled' };
  const time = now(), scheduled = event?.scheduledTime;
  // UTC 00..15 equals Taipei 08..23; reject a stale/replayed delivery, never invent a data date.
  if (event?.cron !== CRON || !Number.isFinite(time) || !Number.isFinite(scheduled)
    || time < scheduled || time - scheduled > 15 * 60000
    || new Date(scheduled).getUTCMinutes() !== 17 || new Date(scheduled).getUTCHours() > 15
    || new Date(time).getUTCHours() > 15) return { code: 'invalid_tick' };
  if (typeof env.GITHUB_TOKEN !== 'string' || !env.GITHUB_TOKEN.trim() || /[\r\n]/.test(env.GITHUB_TOKEN)) return { code: 'missing_secret' };
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'User-Agent': 'DailyInfo-external-scheduler', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: 'main', inputs: { external_schedule: true, source: 'core',
        initialize_state: false, publish_current: false, initialize_manifest: false, checkpoint_run: '', baseline_approval: '' } }),
    });
    const code = [200, 204].includes(response.status) ? 'dispatch_accepted' : 'dispatch_rejected';
    // Manual redirects are rejected without following Location or forwarding credentials.
    // Cleanup failure cannot turn a known HTTP outcome into an ambiguous dispatch.
    try { await response.body?.cancel(); } catch { /* Never read/log response content. */ }
    return { code };
  } catch { return { code: 'dispatch_unconfirmed' }; } // Ambiguous delivery: no POST retry.
  finally { clearTimeout(timer); }
}
export default {
  async scheduled(event, env) {
    const result = await dispatchTick(event, env);
    console.log(result.code); // Fixed allowlist only; accepted is NOT workflow/deployment success.
  },
  fetch() { return new Response('Not found', { status: 404 }); },
};

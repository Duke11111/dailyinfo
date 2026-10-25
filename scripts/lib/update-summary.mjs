import { isoInstant } from '../../src/lib/time.js';
import { SOURCES, assertPublicSafe } from './data-automation.mjs';

const reasons = ['before_window', 'before_market_close', 'weekend', 'already_successful', 'window_already_attempted', 'cooldown', 'window_due', 'recovery_due'];
const codes = ['ok', 'not_due', 'update_failed', 'validation_failed', 'source_delayed'];
function time(value) {
  if (value == null) return 'not available';
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw Error('summary_invalid');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return isoInstant(value);
}
export function updateSummary(report) {
  const rows = report.results.map(item => {
    if (!SOURCES.includes(item.source) || !['updated', 'unchanged', 'skipped', 'failed'].includes(item.status) || !codes.includes(item.code)
      || !reasons.includes(item.retry?.reason)) throw Error('summary_invalid');
    return `| ${item.source} | ${item.status} / ${item.code} | ${time(item.lastSuccessAt)} | ${time(item.sourceDate)} | ${time(item.fetchedAt)} | ${item.retry.reason} / ${time(item.retry.nextEligibleAt)} |`;
  });
  const text = `## DailyInfo source results\n\nTimes are UTC (Taiwan = UTC+08:00). Next eligibility is a planned window, not a guaranteed GitHub execution.\n\n| Source | Result / code | Last successful current-period check | Effective source date | Snapshot fetched | Retry eligibility / next window |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\nsource_delayed means a valid response lacks the expected current date; it is not a schema failure. Unchanged earthquake/news content can be a successful check. Snapshot fetchedAt is never replaced with the check time. Source results do not prove deployment success; see the separate workflow outcome summary.\n`;
  assertPublicSafe(text); return text;
}

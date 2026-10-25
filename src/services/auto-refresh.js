import { nowMs } from '../lib/time.js';
// Only mounted views poll published snapshots; hidden tabs never start a request.
export function startAutoRefresh(tasks, { document: page = globalThis.document, now = nowMs,
  setTimer = setInterval, clearTimer = clearInterval } = {}) {
  let stopped = false;
  const records = tasks.map(task => ({ task, at: now(), busy: false }));
  const check = () => {
    if (stopped || page.visibilityState === 'hidden') return;
    for (const record of records) {
      const { task } = record;
      if (record.busy || task.enabled?.() === false || (now() - Math.max(record.at, task.lastAt?.() ?? 0) < task.interval && !task.due?.())) continue;
      record.at = now(); record.busy = true;
      Promise.resolve().then(() => { if (!stopped && page.visibilityState !== 'hidden') return task.run(); })
        .catch(() => { /* View loaders display errors and retain their own state. */ })
        .finally(() => { record.busy = false; });
    }
  };
  const timer = setTimer(check, 60000);
  page.addEventListener('visibilitychange', check);
  return () => { stopped = true; clearTimer(timer); page.removeEventListener('visibilitychange', check); };
}

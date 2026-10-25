import { instantMs, compareSnapshotTime, assertNoTimeRegression, olderThan, nowMs } from '../lib/time.js';
import { startTiming } from '../lib/timing.js';
import { CACHE_POLICY } from './cache-policy.js';
import { compiledBaseline, behindBaseline } from '../lib/snapshot-freshness.js';
export function browserCacheStorage() { try { return globalThis.localStorage ?? null; } catch { return null; } }
export function persistentRecord(storage, key, validate, now = nowMs, sourceDay = value => value.tradeDate ?? value.fetchedAt) {
  let locked = false;
  return {
    read() {
      if (!storage) return null;
      try {
        const raw = storage.getItem(key); if (raw === null) return null;
        if (raw.length > 2 * 1024 * 1024) throw Error();
        const entry = JSON.parse(raw);
        if (entry.version !== 1 || !Number.isFinite(entry.readAt) || entry.readAt > now() + 300000) throw Error();
        const data = validate(entry.data);
        if (!Number.isFinite(instantMs(data.fetchedAt)) || instantMs(data.fetchedAt) > now() + 300000) throw Error();
        return { ...entry, data, readAt: olderThan(entry.readAt, CACHE_POLICY.persistentMaxAge, now()) ? 0 : entry.readAt };
      } catch { locked = true; return null; } // Preserve corrupt/unknown storage, never silently clear it.
    },
    write(data, readAt) {
      if (!storage || locked) return false;
      try {
        // Another tab may have saved a newer successful snapshot since hydration.
        const raw = storage.getItem(key);
        if (raw !== null) {
          const entry = JSON.parse(raw); if (entry.version !== 1) throw Error();
          const old = validate(entry.data);
          assertNoTimeRegression(data, old, sourceDay);
        }
        storage.setItem(key, JSON.stringify({ version: 1, readAt, data })); return true;
      } catch { return false; }
    },
  };
}
// Factories remain injectable and non-persistent by default; production singletons
// opt in to isolated cache keys. load() stays awaitable, while peek() paints first.
export function createSnapshotStore({ name, fetcher, validate, now = nowMs, ttl = CACHE_POLICY[name], cooldown = CACHE_POLICY.cooldown, storage = null, sourceDay = value => value.fetchedAt, baseline = compiledBaseline(name) } = {}) {
  const disk = persistentRecord(storage, `dailyinfo.cache.${name}.v1`, validate, now, sourceDay);
  const initial = disk.read(); let data = initial?.data ?? null, readAt = initial?.readAt ?? 0, attemptedAt = -Infinity, pending = null;
  const adoptLatestCache = () => {
    const latest = disk.read();
    if (latest && (!data || compareSnapshotTime(latest.data, data, sourceDay) > 0)) { data = latest.data; readAt = latest.readAt; }
  };
  return {
    peek: () => { adoptLatestCache(); return data; },
    load({ force = false } = {}) {
      adoptLatestCache();
      if (pending) return pending;
      const lifetime = typeof ttl === 'function' ? ttl(data, now()) : ttl;
      // readAt remains the cache validation clock; a page read must not extend TTL.
      if (data && ((!force && !behindBaseline(name, data, baseline) && now() - readAt < lifetime) || now() - attemptedAt < cooldown)) return Promise.resolve({ data, readAt, pageReadAt: now(), cached: true });
      if (!data && now() - attemptedAt < cooldown) return Promise.reject(Error('請稍候 10 秒再重試資料。'));
      attemptedAt = now(); const end = startTiming(`${name}.fetch`);
      pending = Promise.resolve().then(fetcher).then(next => {
        adoptLatestCache();
        assertNoTimeRegression(next, data, sourceDay);
        const latest = disk.read();
        assertNoTimeRegression(next, latest?.data, sourceDay);
        data = next; readAt = now(); const persisted = disk.write(data, readAt);
        return { data, readAt, pageReadAt: now(), cached: false, persisted };
      }).finally(() => { end(); pending = null; });
      return pending;
    },
  };
}

import { validateCoordinates } from './regions.js';

const cancelled = () => new DOMException('查詢已取消。', 'AbortError');
// Share transport only. Each consumer keeps its own state and cancellation signal.
export function createRegionalRequests(fetcher) {
  const pending = new Map(); let disposed = false;
  return {
    load(options) {
      if (disposed || options.signal?.aborted) return Promise.reject(cancelled());
      if (!validateCoordinates(options.region)) return Promise.reject(Error('行政區座標無效。'));
      const key = options.region.id; let entry = pending.get(key);
      if (!entry) {
        entry = { controller: new AbortController(), consumers: new Set() };
        pending.set(key, entry);
        entry.promise = Promise.resolve().then(() => fetcher({ ...options, signal: entry.controller.signal }));
        entry.promise.finally(() => { if (pending.get(key) === entry) pending.delete(key); }).catch(() => {});
      }
      return new Promise((resolve, reject) => {
        const consumer = {}; entry.consumers.add(consumer);
        const cleanup = () => { entry.consumers.delete(consumer); options.signal?.removeEventListener('abort', abort); };
        const abort = () => {
          cleanup(); reject(cancelled());
          if (!entry.consumers.size) { if (pending.get(key) === entry) pending.delete(key); entry.controller.abort(); }
        };
        options.signal?.addEventListener('abort', abort, { once: true });
        entry.promise.then(data => { cleanup(); resolve(data); }, error => { cleanup(); reject(error); });
        if (options.signal?.aborted) abort();
      });
    },
    dispose() { disposed = true; for (const entry of pending.values()) entry.controller.abort(); pending.clear(); },
  };
}

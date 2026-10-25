const enabled = import.meta.env?.DEV === true;
export function startTiming(name) {
  if (!enabled || !globalThis.performance) return () => {};
  const start = performance.now();
  return () => {
    const duration = performance.now() - start;
    // Fixed operation names only: never URLs, user text, response bodies or headers.
    performance.measure(`dailyinfo:${name}`, { start, duration });
  };
}

// Access may throw (private browsing, disabled storage, or quota exceeded).
export function readStored(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
export function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

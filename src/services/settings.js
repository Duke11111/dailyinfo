import { readStored, writeStored } from '../lib/storage.js';

export const SETTINGS_KEY = 'dailyinfo.settings.v1';
export const DEFAULT_SETTINGS = Object.freeze({ mode: 'light', accent: 'teal', fontSize: 'standard' });
export const MODES = Object.freeze({ light: '淺色', dark: '深色', system: '跟隨系統' });
export const ACCENTS = Object.freeze({ teal: '森林綠', blue: '海洋藍', violet: '暮光紫', rose: '玫瑰紅', amber: '琥珀棕' });
export const FONT_SIZES = Object.freeze({ small: '小', standard: '標準', large: '大' });
export function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.mode !== 'string' || typeof value.accent !== 'string' || typeof value.fontSize !== 'string'
    || !Object.hasOwn(MODES, value.mode) || !Object.hasOwn(ACCENTS, value.accent) || !Object.hasOwn(FONT_SIZES, value.fontSize)) return { ...DEFAULT_SETTINGS };
  return { mode: value.mode, accent: value.accent, fontSize: value.fontSize };
}
export const loadSettings = () => validateSettings(readStored(SETTINGS_KEY));
export function saveSettings(value) { return writeStored(SETTINGS_KEY, validateSettings(value)); }
export function applySettings(value, root = document.documentElement, systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false) {
  const settings = validateSettings(value);
  root.dataset.theme = settings.mode === 'system' ? (systemDark ? 'dark' : 'light') : settings.mode;
  root.dataset.accent = settings.accent;
  root.dataset.fontSize = settings.fontSize;
}
export function watchSystemTheme(getSettings, onChange = () => {}) {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const listener = () => { if (getSettings().mode === 'system') { applySettings(getSettings()); onChange(); } };
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}

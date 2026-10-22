// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SETTINGS_KEY, DEFAULT_SETTINGS, loadSettings, saveSettings, validateSettings, applySettings, watchSystemTheme } from '../src/services/settings.js';
beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('validated settings persistence', () => {
  it('keeps the Phase 1 default look', () => { expect(loadSettings()).toEqual({ mode: 'light', accent: 'teal', fontSize: 'standard' }); });
  it.each([null, [], 5, 'dark', {}, { mode: ['dark'], accent: 'teal', fontSize: 'large' }, { mode: 'dark', accent: 'invalid', fontSize: 'large' }, { mode: '__proto__', accent: 'teal', fontSize: 'small' }])('rejects malformed settings %j', value => { expect(validateSettings(value)).toEqual(DEFAULT_SETTINGS); });
  it('stores only known fields and restores all preferences', () => {
    expect(saveSettings({ mode: 'dark', accent: 'violet', fontSize: 'large', unsafe: '<img>' })).toBe(true);
    expect(loadSettings()).toEqual({ mode: 'dark', accent: 'violet', fontSize: 'large' });
    expect(localStorage.getItem(SETTINGS_KEY)).not.toContain('unsafe');
  });
  it('preserves every mode, accent and font combination without changing other personal storage', () => {
    localStorage.setItem('dailyinfo.calendar.events.v1', 'keep-calendar');
    localStorage.setItem('dailyinfo.news.favorites.v1', 'keep-favorites');
    for (const mode of ['light', 'dark', 'system']) for (const accent of ['teal', 'blue', 'violet', 'rose', 'amber']) for (const fontSize of ['small', 'standard', 'large']) {
      const settings = { mode, accent, fontSize };
      expect(saveSettings(settings)).toBe(true); expect(loadSettings()).toEqual(settings);
      applySettings(loadSettings(), document.documentElement, true);
      expect(document.documentElement.dataset).toMatchObject({ theme: mode === 'light' ? 'light' : 'dark', accent, fontSize });
    }
    expect(localStorage.getItem('dailyinfo.calendar.events.v1')).toBe('keep-calendar');
    expect(localStorage.getItem('dailyinfo.news.favorites.v1')).toBe('keep-favorites');
  });
  it('recovers from corrupt JSON', () => { localStorage.setItem(SETTINGS_KEY, '{broken'); expect(loadSettings()).toEqual(DEFAULT_SETTINGS); });
  it('does not crash when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota'); });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS); expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
  });
  it.each(['teal', 'blue', 'violet', 'rose', 'amber'])('applies %s globally', accent => {
    applySettings({ mode: 'dark', accent, fontSize: 'large' });
    expect(document.documentElement.dataset).toMatchObject({ theme: 'dark', accent, fontSize: 'large' });
  });
  it('follows system appearance and listens to later changes', () => {
    let listener; const media = { matches: false, addEventListener: (_, fn) => { listener = fn; }, removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => media);
    let settings = { ...DEFAULT_SETTINGS, mode: 'system' };
    applySettings(settings); expect(document.documentElement.dataset.theme).toBe('light');
    const stop = watchSystemTheme(() => settings);
    media.matches = true; listener(); expect(document.documentElement.dataset.theme).toBe('dark');
    settings = { ...DEFAULT_SETTINGS, mode: 'light' }; applySettings(settings);
    listener(); expect(document.documentElement.dataset.theme).toBe('light');
    stop(); expect(media.removeEventListener).toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { resolveRoute, routes } from '../src/router.js';
describe('routes', () => {
  it.each(Object.keys(routes))('resolves %s', (route) => { expect(resolveRoute(`#/${route}`)).toBe(route); });
  it('resolves earthquake detail links', () => { expect(resolveRoute('#/earthquakes?event=test')).toBe('earthquakes'); });
  it('falls back to overview for an unknown route', () => { expect(resolveRoute('#/missing')).toBe('overview'); });
});
describe('actual application navigation', () => {
  let application;
  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '<a class="skip-link" href="#main">跳至主要內容</a><div id="app"></div>';
    window.history.replaceState(null, '', '#/overview');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    localStorage.clear();
    application = await import('../src/main.js');
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
  });
  afterEach(() => { application.dispose(); vi.unstubAllGlobals(); });
  it('switches all pages and highlights the current page', async () => {
    for (const [route, meta] of Object.entries(routes)) {
      const link = document.querySelector(`[data-route="${route}"]`);
      link.click();
      await vi.waitFor(() => expect(document.querySelector('h1').textContent).toContain(meta.title));
      expect(link.getAttribute('aria-current')).toBe('page');
      if (route === 'earthquakes') expect(document.querySelector('#earthquakes-host')).not.toBeNull();
      if (route === 'stocks') expect(document.querySelector('#stocks-host')).not.toBeNull();
      if (route === 'news') expect(document.querySelector('#news-host')).not.toBeNull();
    }
  });
  it('retries the API when refresh is clicked', async () => {
    const calls = fetch.mock.calls.length;
    document.querySelector('[data-overview-weather-refresh]').click();
    await vi.waitFor(() => expect(fetch.mock.calls.length).toBe(calls + 1));
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
  });
  it('keeps stock navigation working without a retired finance link or bank request', async () => {
    document.querySelector('[data-route="stocks"]').click();
    await vi.waitFor(() => expect(document.querySelector('.stocks-page')).not.toBeNull());
    expect(document.querySelector('.finance-nav')).toBeNull();
    expect(document.body.textContent).not.toContain('匯率');
    expect(fetch.mock.calls.some(([url]) => String(url).includes('rate.bot.com.tw'))).toBe(false);
  });

});

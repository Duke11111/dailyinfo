// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { regions, counties, getRegion, getDistricts, searchRegions, DEFAULT_REGION, REGION_KEY, loadRegion, saveRegion, validateCoordinates } from '../src/services/regions.js';
import { mountRegionPicker } from '../src/components/region-picker.js';
import { mountOverviewRegion } from '../src/components/overview-region.js';
import { loadOverviewRegion, saveOverviewRegion } from '../src/services/overview-region.js';
import { buildWeatherUrl, fetchWeather } from '../src/services/weather.js';
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe('complete administrative dataset', () => {
  it('orders exactly the 22 canonical counties from north to south, east and islands', () => {
    expect(counties).toEqual([
      '臺北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣',
      '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣',
      '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣',
      '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣',
    ]);
    expect(new Set(counties).size).toBe(22);
    expect(new Set(counties)).toEqual(new Set(regions.map(region => region.county)));
  });
  it('covers all 22 counties and 368 unique districts, including islands', () => {
    expect(counties).toHaveLength(22); expect(regions).toHaveLength(368); expect(new Set(regions.map(r => r.id)).size).toBe(368);
    expect(regions.every(validateCoordinates)).toBe(true);
    expect(getDistricts('澎湖縣')).toHaveLength(6); expect(getDistricts('金門縣')).toHaveLength(6); expect(getDistricts('連江縣')).toHaveLength(4);
  });
  it('only returns districts belonging to the chosen county', () => {
    expect(getDistricts('臺北市')).toHaveLength(12); expect(getDistricts('高雄市')).toHaveLength(38);
    expect(getDistricts('不存在')).toEqual([]); expect(getDistricts(null)).toEqual([]);
    expect(getDistricts('苗栗縣').every(r => r.county === '苗栗縣')).toBe(true);
  });
  it('finds counties, districts, full names, 台/臺 and ambiguous names', () => {
    expect(searchRegions('台北市')).toHaveLength(12);
    expect(searchRegions(' 臺北市 大安區 ')).toEqual([getRegion('63000030')]);
    expect(searchRegions('竹南')).toEqual([getRegion('10005040')]);
    expect(searchRegions('大安區')).toHaveLength(2);
    expect(searchRegions('左營區')[0].county).toBe('高雄市');
  });
  it.each(['', '   ', '<img src=x onerror=alert(1)>', '不存在的地區', null, 'a'.repeat(81)])('does not invent a match for %j', query => { expect(searchRegions(query)).toEqual([]); });
  it('restores only known region IDs, ignoring injected coordinates', () => {
    expect(saveRegion('10005040')).toBe(true); expect(loadRegion()).toEqual(getRegion('10005040'));
    localStorage.setItem(REGION_KEY, JSON.stringify({ id: '64000030', latitude: 99, longitude: -99 }));
    expect(loadRegion()).toEqual(getRegion('64000030'));
    expect(saveRegion('bad')).toBe(false);
  });
  it.each(['null', '[]', '123', '"63000030"', '{bad', '{"id":63000030}', '{"id":"bad"}'])('falls back for invalid storage %s', text => {
    localStorage.setItem(REGION_KEY, text); expect(loadRegion()).toEqual(DEFAULT_REGION);
  });
  it('falls back and reports failure when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error(); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error(); });
    expect(loadRegion()).toEqual(DEFAULT_REGION); expect(saveRegion(DEFAULT_REGION.id)).toBe(false);
  });
});
describe('canonical coordinates sent to weather API', () => {
  it.each(['63000030', '10005040', '64000030'])('uses verified %s coordinates', async id => {
    const region = getRegion(id), url = new URL(buildWeatherUrl(region));
    expect(Number(url.searchParams.get('latitude'))).toBe(region.latitude);
    expect(Number(url.searchParams.get('longitude'))).toBe(region.longitude);
    const mock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(fetchWeather({ region, fetchImpl: mock })).rejects.toMatchObject({ kind: 'network' });
    expect(mock.mock.calls[0][0]).toBe(url.toString());
  });
  it.each([null, {}, { ...DEFAULT_REGION, latitude: NaN }, { ...DEFAULT_REGION, longitude: '121' }, { ...DEFAULT_REGION, latitude: 99 }, { ...DEFAULT_REGION, latitude: 25.1 }, { ...DEFAULT_REGION, county: '高雄市' }])('rejects unverified coordinates without fetching', async region => {
    const mock = vi.fn();
    await expect(fetchWeather({ region, fetchImpl: mock })).rejects.toMatchObject({ kind: 'location' });
    expect(mock).not.toHaveBeenCalled();
  });
});
describe('region picker DOM', () => {
  it('uses identical county order in both pickers without changing independently saved regions', () => {
    saveRegion('63000040'); saveOverviewRegion('10005040');
    const storedBefore = { ...localStorage };
    const pageHost = document.createElement('div'), homeHost = document.createElement('div');
    mountRegionPicker(pageHost, loadRegion(), vi.fn());
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
    const dispose = mountOverviewRegion(homeHost, { selection: loadOverviewRegion(), onSave: vi.fn() });
    try {
      homeHost.querySelector('button').click();
      const pageCounty = pageHost.querySelector('#county-select'), homeCounty = homeHost.querySelector('select');
      const labels = select => [...select.options].map(option => [option.value, option.textContent]);
      expect(labels(pageCounty)).toEqual(counties.map(county => [county, county]));
      expect(labels(homeCounty)).toEqual(labels(pageCounty));
      expect(pageCounty.value).toBe('臺北市');
      expect(pageHost.querySelector('#district-select').value).toBe('63000040');
      expect(homeCounty.value).toBe('苗栗縣');
      expect(homeHost.querySelectorAll('select')[1].value).toBe('10005040');
      expect({ ...localStorage }).toEqual(storedBefore);
    } finally {
      dispose();
      delete HTMLDialogElement.prototype.showModal;
      delete HTMLDialogElement.prototype.close;
    }
  });
  it('resets district after county change and submits only valid combinations', () => {
    const host = document.createElement('div'), select = vi.fn(); mountRegionPicker(host, DEFAULT_REGION, select);
    const county = host.querySelector('#county-select'), district = host.querySelector('#district-select');
    county.value = '苗栗縣'; county.dispatchEvent(new Event('change'));
    expect(district.value).toBe(''); expect(district.options.length).toBe(19);
    expect(select).not.toHaveBeenCalled();
    host.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(select).not.toHaveBeenCalled();
    district.value = '10005040'; host.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(select).toHaveBeenCalledWith(getRegion('10005040'));
  });
  it('selects search results without executing HTML or treating typing as a query', () => {
    const host = document.createElement('div'), select = vi.fn(); mountRegionPicker(host, DEFAULT_REGION, select);
    const input = host.querySelector('input'); input.value = '<img src=x onerror=alert(1)>'; input.dispatchEvent(new Event('input'));
    expect(host.querySelector('img')).toBeNull(); expect(host.textContent).toContain('查無地區');
    input.value = '竹南'; input.dispatchEvent(new Event('input'));
    host.querySelector('#search-results button').click();
    expect(host.querySelector('#county-select').value).toBe('苗栗縣'); expect(host.querySelector('#district-select').value).toBe('10005040');
    expect(select).not.toHaveBeenCalled();
    host.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(select).toHaveBeenCalledWith(getRegion('10005040'));
  });
});

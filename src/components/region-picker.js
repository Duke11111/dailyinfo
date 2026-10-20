import { counties, getDistricts, getRegion, searchRegions } from '../services/regions.js';

// Inputs and dynamic result labels are assigned using DOM properties/textContent.
export function mountRegionPicker(host, selectedRegion, onSelect) {
  host.innerHTML = `<section class="card region-picker" aria-labelledby="region-title"><div class="section-heading"><div><span class="eyebrow">EXPLORE TAIWAN</span><h2 id="region-title">查詢臺灣天氣</h2></div><span class="badge">22 縣市 · 368 鄉鎮市區</span></div>
    <div class="region-search"><label for="region-search">地名搜尋</label><input id="region-search" type="search" maxlength="80" placeholder="例如：竹南、臺北市大安區" autocomplete="off" aria-describedby="search-hint"><p id="search-hint">支援台／臺寫法；搜尋後請選擇確切行政區。</p><p id="search-summary" role="status"></p><ul id="search-results" class="search-results"></ul></div>
    <form id="region-form" class="region-form"><div class="region-field"><label for="county-select">縣市</label><select id="county-select" required></select></div><div class="region-field"><label for="district-select">鄉鎮市區</label><select id="district-select" required></select></div><button class="primary" type="submit">查詢天氣</button></form>
    <p id="region-feedback" class="region-feedback" role="status"></p><p class="region-source">行政區：<a href="https://data.gov.tw/dataset/7441" target="_blank" rel="noopener noreferrer">國土測繪中心</a> · <a href="https://data.gov.tw/license" target="_blank" rel="noopener noreferrer">政府資料開放授權條款第 1 版</a>。使用區界內代表點查詢數值模式預報，非當地測站觀測。</p></section>`;
  const county = host.querySelector('#county-select'), district = host.querySelector('#district-select');
  const feedback = host.querySelector('#region-feedback');
  const option = (value, text) => new Option(text, value);
  counties.forEach(name => county.add(option(name, name)));
  function updateDistricts(id = '') {
    district.replaceChildren(option('', '請選擇鄉鎮市區'));
    getDistricts(county.value).forEach(r => district.add(option(r.id, r.district)));
    district.value = id;
  }
  county.value = selectedRegion.county;
  updateDistricts(selectedRegion.id);
  county.addEventListener('change', () => { updateDistricts(); feedback.textContent = '請選擇鄉鎮市區，再按「查詢天氣」。'; });
  host.querySelector('#region-form').addEventListener('submit', event => {
    event.preventDefault();
    const region = getRegion(district.value);
    if (!region || region.county !== county.value) { feedback.textContent = '請選擇有效的縣市與鄉鎮市區。'; return; }
    feedback.textContent = '';
    onSelect(region);
  });
  host.querySelector('#region-search').addEventListener('input', event => {
    const query = event.target.value;
    const matches = searchRegions(query);
    const results = host.querySelector('#search-results');
    results.replaceChildren();
    host.querySelector('#search-summary').textContent = !query.trim() ? '' : matches.length ? `找到 ${matches.length} 個地區${matches.length > 20 ? '，顯示前 20 筆；請增加關鍵字縮小範圍。' : '。'}` : '查無地區，請確認縣市或鄉鎮市區名稱。';
    matches.slice(0, 20).forEach(region => {
      const li = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.textContent = `${region.county} ${region.district}`;
      button.addEventListener('click', () => {
        county.value = region.county; updateDistricts(region.id);
        results.replaceChildren();
        host.querySelector('#search-summary').textContent = `已選擇 ${region.county} ${region.district}，請按「查詢天氣」。`;
        host.querySelector('#region-form button').focus();
      });
      li.append(button); results.append(li);
    });
  });
}

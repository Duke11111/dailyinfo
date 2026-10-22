import { counties, getDistricts, getRegion, regionLabel } from '../services/regions.js';

const el = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
export function mountOverviewRegion(host, { selection, onSave }) {
  let current = selection, dialog;
  const row = el('div', '', 'overview-region-control'), label = el('strong'), status = el('p', '', 'overview-caption');
  const change = el('button', '變更地區', 'overview-refresh'); change.type = 'button';
  row.append(label, change); host.append(row, status);
  function render() {
    label.textContent = `首頁常用地區：${regionLabel(current.region)}`;
    status.textContent = current.problem || (current.saved ? '已儲存於此瀏覽器；與完整天氣頁的查詢地區互相獨立。' : '尚未儲存常用地區，目前使用預設臺北市大安區。');
  }
  change.addEventListener('click', () => {
    dialog?.remove(); dialog = el('dialog', '', 'overview-region-dialog');
    const title = el('h2', '設定我的地區'); title.id = 'overview-region-title'; dialog.setAttribute('aria-labelledby', title.id);
    const form = el('form'), countyLabel = el('label', '縣市'), districtLabel = el('label', '鄉鎮市區');
    const county = el('select'), district = el('select'); county.required = district.required = true;
    counties.forEach(name => county.add(new Option(name, name))); county.value = current.region.county;
    function update(id = '') { district.replaceChildren(new Option('請選擇鄉鎮市區', '')); getDistricts(county.value).forEach(region => district.add(new Option(region.district, region.id))); district.value = id; }
    update(current.region.id); county.addEventListener('change', () => update());
    countyLabel.append(county); districtLabel.append(district);
    const error = el('p', '', 'overview-error'); error.setAttribute('role', 'alert');
    const actions = el('div', '', 'overview-actions'), cancel = el('button', '取消', 'overview-refresh'), save = el('button', '儲存我的地區', 'primary');
    cancel.type = 'button'; save.type = 'submit'; cancel.addEventListener('click', () => dialog.close()); actions.append(cancel, save);
    form.append(countyLabel, districtLabel, el('p', '只有按下儲存才會變更首頁天氣、七日預報與 AQI；完整天氣頁的查詢不受影響。', 'overview-caption'), error, actions);
    form.addEventListener('submit', event => {
      event.preventDefault(); const region = getRegion(district.value);
      if (!region || region.county !== county.value) { error.textContent = '請選擇有效的縣市與鄉鎮市區。'; return; }
      try { current = onSave(region); render(); dialog.close(); }
      catch (failure) { error.textContent = failure.message; status.textContent = failure.message; }
    });
    dialog.addEventListener('close', () => change.focus());
    dialog.append(title, form); host.append(dialog); dialog.showModal(); county.focus();
  });
  render();
  return () => { if (dialog?.open) dialog.close(); dialog?.remove(); };
}

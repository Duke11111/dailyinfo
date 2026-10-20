import { MODES, ACCENTS, FONT_SIZES } from '../services/settings.js';

// All template values come from validated enums, never user-entered HTML.
function choices(name, title, options, current, description) {
  return `<fieldset class="settings-group"><legend>${title}</legend><p>${description}</p><div class="setting-options">${Object.entries(options).map(([key, label]) => `<label class="setting-option"><input type="radio" name="${name}" value="${key}" ${current === key ? 'checked' : ''}>${name === 'accent' ? `<span class="color-swatch" data-swatch="${key}" aria-hidden="true"></span>` : ''}<span>${label}</span></label>`).join('')}</div></fieldset>`;
}
export function renderSettings(settings, saved) {
  return `<section class="card settings-card"><div class="section-heading"><div><span class="eyebrow">MAKE IT YOURS</span><h2>外觀與閱讀偏好</h2></div><span class="badge">全站套用</span></div><form id="settings-form">
    ${choices('mode', '顯示模式', MODES, settings.mode, '選擇淺色、深色，或隨裝置系統外觀自動切換。')}
    ${choices('accent', '主題強調色', ACCENTS, settings.accent, '同步調整導覽、按鈕、天氣卡與選取狀態。')}
    ${choices('fontSize', '字體大小', FONT_SIZES, settings.fontSize, '調整所有頁面的文字，包含導覽、資訊卡與預報數值。')}
    <p id="settings-status" class="settings-status" role="status">${saved ? '設定會自動儲存在此瀏覽器，重新載入仍有效。' : '無法寫入瀏覽器儲存空間；目前設定僅在本次使用期間有效。'}</p>
    <button type="button" class="refresh-button" data-reset-settings>恢復預設外觀</button>
    </form></section>`;
}

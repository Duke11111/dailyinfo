import { routes } from '../router.js';
import { icon } from '../lib/icons.js';
export function renderPlaceholder(route) {
  return `<section class="card placeholder"><span class="placeholder-icon">${icon(routes[route].icon)}</span><span class="badge">尚未串接</span><h2>${routes[route].title}，即將加入你的日常</h2><p>第一階段已完成頁面架構。此模組尚未連接資料來源，<br class="desktop-break">目前沒有可顯示的真實資料。</p><a class="primary" href="#/overview">返回每日總覽${icon('arrow')}</a><div class="placeholder-note">${icon('info')}資料來源與更新時間將於完成串接後顯示</div></section>`;
}

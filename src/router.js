export const routes = {
  overview: { title: '每日總覽', english: 'YOUR DAILY BRIEF', description: '把重要的日常資訊，收進同一個畫面。', icon: 'grid' },
  weather: { title: '天氣資訊', english: 'WEATHER FORECAST', description: '出門之前，先掌握各地的天氣變化。', icon: 'sun' },
  stocks: { title: '股票市場', english: 'MARKET WATCH', description: '搜尋上市股票與 ETF，整理你的多群組自選清單。', icon: 'stock' },
  news: { title: '焦點新聞', english: 'NEWS BRIEFING', description: '中央通訊社新聞摘要，依分類探索並收藏重要消息。', icon: 'news' },
  earthquakes: { title: '地震資訊', english: 'EARTHQUAKE REPORTS', description: '查詢中央氣象署地震報告，探索臺灣震央與觀測震度。', icon: 'quake' },
  calendar: { title: '行事曆', english: 'PERSONAL CALENDAR', description: '從月曆開始，安排每一天的步調。', icon: 'calendar' },
  settings: { title: '設定', english: 'YOUR PREFERENCES', description: '讓 DailyInfo 更符合你的閱讀習慣。', icon: 'settings' },
};
export const resolveRoute = (hash) => {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  return Object.hasOwn(routes, path) ? path : 'overview';
};
export function createRouter(onChange, target = window) {
  const listener = () => onChange(resolveRoute(target.location.hash));
  target.addEventListener('hashchange', listener);
  listener();
  return () => target.removeEventListener('hashchange', listener);
}

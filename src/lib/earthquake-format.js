export function formatEarthquakeTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '未提供';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value)).replace(/\s+/g, ' ');
}

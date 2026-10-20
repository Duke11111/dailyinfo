import { snapshotTarget } from './lib/snapshot-target.mjs';
import { updateHoroscope } from './lib/horoscope-import.mjs';
try {
  const data = await updateHoroscope({ target: snapshotTarget('horoscope') });
  console.log(`運勢快照更新成功：${data.readings.length} 星座 · 來源日期 ${data.readings[0].date} · 擷取 ${data.fetchedAt}`);
} catch (error) { console.error(`運勢更新失敗，既有快照保留：${error.message}`); process.exitCode = 1; }

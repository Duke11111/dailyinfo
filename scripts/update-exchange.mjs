import { updateExchange } from './lib/exchange-import.mjs';
import { snapshotTarget } from './lib/snapshot-target.mjs';
try {
  const snapshot = await updateExchange({ target: snapshotTarget('exchange') });
  console.log(JSON.stringify({ source: snapshot.source, quotedAt: snapshot.quotedAt, fetchedAt: snapshot.fetchedAt, currencies: snapshot.rates.length, samples: snapshot.rates.filter(rate => ['USD', 'JPY', 'EUR', 'KRW'].includes(rate.code)) }, null, 2));
} catch (error) { console.error(`匯率更新失敗：${error.message}；既有有效快照不變。`); process.exitCode = 1; }

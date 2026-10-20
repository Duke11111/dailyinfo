import { updateExchange } from './lib/exchange-import.mjs';
import { snapshotTarget } from './lib/snapshot-target.mjs';
import { exchangeErrorCode, exchangeExitStatus } from './lib/exchange-errors.mjs';
try {
  const snapshot = await updateExchange({ target: snapshotTarget('exchange') });
  console.log(JSON.stringify({ source: snapshot.source, quotedAt: snapshot.quotedAt, fetchedAt: snapshot.fetchedAt, currencies: snapshot.rates.length, samples: snapshot.rates.filter(rate => ['USD', 'JPY', 'EUR', 'KRW'].includes(rate.code)) }, null, 2));
} catch (error) { console.error(`Exchange update failed: ${exchangeErrorCode(error)}. Previous snapshot preserved.`); process.exitCode = exchangeExitStatus(error); }

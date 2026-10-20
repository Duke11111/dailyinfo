import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Node-only output override used by the isolated automatic updater.
export function snapshotTarget(name) {
  if (!['quotes', 'news', 'earthquakes', 'horoscope'].includes(name)) throw Error('Invalid snapshot target');
  return resolve(process.env.DAILYINFO_DATA_DIR || fileURLToPath(new URL('../../public/data', import.meta.url)), `${name}.json`);
}

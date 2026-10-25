import { formatTaipei } from './time.js';
export function formatEarthquakeTime(value) { return formatTaipei(value, { seconds: true }); }

// Node.js only. Never import this module from src/ or expose its return value in snapshots.
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Called only by a future explicitly executed local update script, not on import.
export function getCwaApiKey() {
  // GitHub Secrets / trusted process environment take priority; CI never needs a file.
  if (process.env.CWA_API_KEY?.trim()) return process.env.CWA_API_KEY.trim();
  if (process.env.CI) throw new Error('地震更新缺少 CWA_API_KEY 環境變數。');
  try { loadEnvFile(fileURLToPath(new URL('../../.env.local', import.meta.url))); }
  catch { throw new Error('無法載入本機 .env.local；請檢查檔案是否存在及可讀取。'); }
  const key = process.env.CWA_API_KEY?.trim();
  if (!key) throw new Error('請先在 .env.local 填入 CWA_API_KEY，再執行本機更新腳本。');
  // Never log the key, authenticated request URLs, or raw authentication errors.
  return key;
}

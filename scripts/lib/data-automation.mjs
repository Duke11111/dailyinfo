import { readFile, writeFile, rename, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { validateQuoteSnapshot } from '../../src/services/quotes.js';
import { validateNewsSnapshot } from '../../src/services/news.js';
import { validateEarthquakeSnapshot } from '../../src/services/earthquakes.js';
import { validateExchangeSnapshot } from '../../src/services/exchange.js';
import { validateHoroscope, taipeiDate } from '../../src/services/horoscope.js';

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SOURCES = Object.freeze(['quotes', 'news', 'earthquakes', 'exchange', 'horoscope']);
const validators = { quotes: validateQuoteSnapshot, news: validateNewsSnapshot, earthquakes: validateEarthquakeSnapshot, exchange: validateExchangeSnapshot, horoscope: validateHoroscope };
const runFile = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const safeFailure = code => Object.assign(Error(code), { safeCode: code });

export function assertPublicSafe(content, secrets = [process.env.CWA_API_KEY]) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  if (/(?:CWA-[a-z0-9-]{20,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sk-[a-z0-9]{20,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|"(?:authorization|api[_-]?key|access[_-]?token|secret|password)"\s*:)/i.test(text) || secrets.some(secret => typeof secret === 'string' && secret.length >= 8 && text.includes(secret))) throw safeFailure('secret_detected');
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['fetchedAt', 'sha256', 'evidence', 'responseHeaders'].includes(key)).map(key => [key, canonical(value[key])]));
  return value;
}
export const contentDigest = data => hash(JSON.stringify(canonical(data)));
export function validateData(source, value, now = Date.now()) {
  if (!SOURCES.includes(source)) throw safeFailure('unknown_source');
  assertPublicSafe(value);
  const data = validators[source](value);
  if (!iso(data.fetchedAt) || Date.parse(data.fetchedAt) > now + 300000) throw safeFailure('future_snapshot');
  if (source === 'news' && !data.articles.length || source === 'earthquakes' && !data.events.length) throw safeFailure('empty_snapshot');
  const date = sourceDate(source, data);
  if (!date || date.slice(0, 10) > taipeiDate(now)) throw safeFailure('future_source_date');
  return data;
}
export function sourceDate(source, data) {
  if (source === 'quotes') return data.tradeDate;
  if (source === 'exchange') return data.quotedAt;
  if (source === 'horoscope') return data.readings[0]?.date;
  if (source === 'news') return [...data.articles].map(item => item.publishedAt).sort().at(-1);
  return [...data.events].map(item => item.originTime).sort().at(-1);
}
export function validateState(raw, now = Date.now()) {
  if (raw?.version !== 1 || !raw.sources || typeof raw.sources !== 'object' || Array.isArray(raw.sources)) throw safeFailure('state_invalid');
  const sources = {};
  for (const name of Object.keys(raw.sources)) {
    const item = raw.sources[name];
    if (!SOURCES.includes(name) || !iso(item?.attemptedAt) || Date.parse(item.attemptedAt) > now + 300000 || !['updated', 'unchanged', 'failed'].includes(item.status) || !['ok', 'update_failed', 'validation_failed'].includes(item.code) || item.lastSuccessAt != null && (!iso(item.lastSuccessAt) || Date.parse(item.lastSuccessAt) > Date.parse(item.attemptedAt))) throw safeFailure('state_invalid');
    sources[name] = { attemptedAt: item.attemptedAt, status: item.status, code: item.code, ...(item.lastSuccessAt ? { lastSuccessAt: item.lastSuccessAt } : {}) };
  }
  return { version: 1, sources };
}
export function isDue(source, state, now = Date.now()) {
  if (!SOURCES.includes(source)) return false;
  const local = new Date(now + 8 * 3600000), day = local.getUTCDay(), hour = local.getUTCHours();
  const previous = state.sources[source]?.attemptedAt;
  if (['news', 'earthquakes'].includes(source)) return !previous || now - Date.parse(previous) >= 150 * 60000;
  if (['quotes', 'exchange'].includes(source) && (day === 0 || day === 6)) return false;
  const cutoff = source === 'quotes' ? 17 : source === 'exchange' ? 15 : 9;
  return hour >= cutoff && (!previous || taipeiDate(previous) !== taipeiDate(now) || new Date(Date.parse(previous) + 8 * 3600000).getUTCHours() < cutoff);
}
async function optionalJson(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function atomicWrite(file, data) { const temp = `${file}.tmp`; await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`); await rename(temp, file); }
export async function runSource(source, { root, directory }) {
  try {
    // Never forward child stdout/stderr, URLs, arbitrary exceptions or authenticated bodies.
    const env = { ...process.env, DAILYINFO_DATA_DIR: directory };
    if (source !== 'earthquakes') delete env.CWA_API_KEY;
    await runFile(process.execPath, [join(root, 'scripts', `update-${source}.mjs`)], { cwd: root, env, timeout: 210000, maxBuffer: 1048576, windowsHide: true });
  } catch { throw safeFailure('update_failed'); }
}
export async function updateData({ root = PROJECT_ROOT, sources = SOURCES, scheduled = false, now = Date.now, runner = runSource } = {}) {
  if (!sources.length || new Set(sources).size !== sources.length || sources.some(name => !SOURCES.includes(name))) throw safeFailure('unknown_source');
  const base = resolve(root, '.cache/data-updates'); await mkdir(base, { recursive: true });
  const lock = join(base, 'lock');
  try { await mkdir(lock); } catch { throw safeFailure('update_locked'); }
  let staging;
  try {
    const statePath = join(base, 'status.json');
    const old = await optionalJson(statePath), state = old ? validateState(old, now()) : { version: 1, sources: {} };
    staging = await mkdtemp(join(base, 'run-'));
    const results = [], startedAt = new Date(now()).toISOString();
    for (const source of sources) {
      if (scheduled && !isDue(source, state, now())) { results.push({ source, status: 'skipped', code: 'not_due' }); continue; }
      const target = join(root, 'public/data', `${source}.json`), directory = join(staging, source); await mkdir(directory);
      let previous;
      try {
        const raw = await optionalJson(target); previous = raw ? validateData(source, raw, now()) : null;
        if (previous) await copyFile(target, join(directory, `${source}.json`));
        try { await runner(source, { root, directory }); } catch { throw safeFailure('update_failed'); }
        const rawNext = await optionalJson(join(directory, `${source}.json`));
        const next = validateData(source, rawNext, now());
        if (previous && (sourceDate(source, next) < sourceDate(source, previous) || Date.parse(next.fetchedAt) < Date.parse(previous.fetchedAt))) throw safeFailure('validation_failed');
        if (source === 'horoscope' && next.readings[0].date !== taipeiDate(now())) throw safeFailure('validation_failed');
        const changed = !previous || contentDigest(previous) !== contentDigest(next);
        if (changed) { await mkdir(join(root, 'public/data'), { recursive: true }); await atomicWrite(target, rawNext); }
        const item = { attemptedAt: startedAt, status: changed ? 'updated' : 'unchanged', code: 'ok', lastSuccessAt: startedAt };
        state.sources[source] = item;
        const accepted = changed ? next : previous;
        results.push({ source, ...item, sourceDate: sourceDate(source, accepted), fetchedAt: accepted.fetchedAt });
      } catch (error) {
        const code = error.safeCode === 'update_failed' ? 'update_failed' : 'validation_failed';
        const item = { attemptedAt: startedAt, status: 'failed', code, ...(state.sources[source]?.lastSuccessAt ? { lastSuccessAt: state.sources[source].lastSuccessAt } : {}) };
        state.sources[source] = item; results.push({ source, ...item });
      }
    }
    const report = { version: 1, startedAt, changed: results.some(item => item.status === 'updated'), failed: results.filter(item => item.status === 'failed').length, results };
    assertPublicSafe(state); assertPublicSafe(report);
    await atomicWrite(statePath, state); await atomicWrite(join(base, 'report.json'), report);
    return report;
  } finally {
    // Only our freshly created directory inside this project's ignored cache.
    if (staging && resolve(staging).startsWith(base + sep)) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true });
  }
}
export async function verifyPublicTree(root, secrets) {
  const { readdir } = await import('node:fs/promises');
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink() || /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore)|id_(?:rsa|ed25519|ecdsa)|credentials\.json|service-account.*\.json|\.n(?:et|pm)rc|.*\.tmp)$/i.test(entry.name)) throw safeFailure('forbidden_public_file');
      if (entry.isDirectory()) await walk(path);
      else assertPublicSafe(await readFile(path, 'utf8'), secrets);
    }
  }
  await walk(root);
}
export async function verifySnapshots(root = PROJECT_ROOT, now = Date.now()) {
  for (const source of SOURCES) validateData(source, await optionalJson(join(root, 'public/data', `${source}.json`)), now);
  await verifyPublicTree(join(root, 'public'));
}

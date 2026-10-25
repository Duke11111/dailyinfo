import { isoInstant, nowMs } from '../../src/lib/time.js';
import { compareSnapshots } from '../../src/lib/snapshot-freshness.js';
import { readFile, writeFile, rename, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { validateQuoteSnapshot } from '../../src/services/quotes.js';
import { validateNewsSnapshot } from '../../src/services/news.js';
import { validateEarthquakeSnapshot } from '../../src/services/earthquakes.js';
import { validateHoroscope, taipeiDate } from '../../src/services/horoscope.js';
import { scheduleDecision } from './source-schedule.mjs';
export { isDue } from './source-schedule.mjs';

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SOURCES = Object.freeze(['quotes', 'news', 'earthquakes', 'horoscope']);
export const CORE_SOURCES = SOURCES;
export function selectUpdateSources(selection = 'all', scheduled = false) {
  const sources = selection === 'all' ? [...SOURCES] : selection === 'core' ? [...CORE_SOURCES] : typeof selection === 'string' ? selection.split(',') : [];
  if (!sources.length || new Set(sources).size !== sources.length || sources.some(source => !SOURCES.includes(source))) throw safeFailure('unknown_source');
  const selected = scheduled ? sources.filter(source => CORE_SOURCES.includes(source)) : sources;
  if (!selected.length) throw safeFailure('unknown_source');
  return selected;
}
const validators = { quotes: validateQuoteSnapshot, news: validateNewsSnapshot, earthquakes: validateEarthquakeSnapshot, horoscope: validateHoroscope };
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
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['fetchedAt', 'updatedAt', 'sha256', 'evidence', 'responseHeaders'].includes(key)).map(key => [key, canonical(value[key])]));
  return value;
}
export const contentDigest = data => hash(JSON.stringify(canonical(data)));
export function validateData(source, value, now = nowMs()) {
  if (!SOURCES.includes(source)) throw safeFailure('unknown_source');
  assertPublicSafe(value);
  const data = validators[source](value);
  if (data.updatedAt !== undefined && (!iso(data.updatedAt) || Date.parse(data.updatedAt) > now + 300000)) throw safeFailure('future_snapshot');
  if (!iso(data.fetchedAt) || Date.parse(data.fetchedAt) > now + 300000) throw safeFailure('future_snapshot');
  if (source === 'news' && !data.articles.length || source === 'earthquakes' && !data.events.length) throw safeFailure('empty_snapshot');
  const date = sourceDate(source, data);
  if (!date || (date.includes('T') ? taipeiDate(date) : date) > taipeiDate(now)) throw safeFailure('future_source_date');
  return data;
}
export function sourceDate(source, data) {
  if (source === 'quotes') return data.tradeDate;
  if (source === 'horoscope') return data.readings[0]?.date;
  if (source === 'news') return [...data.articles].map(item => item.publishedAt).sort().at(-1);
  return [...data.events].map(item => item.originTime).sort().at(-1);
}
export function validateState(raw, now = nowMs()) {
  if (raw?.version !== 1 || !raw.sources || typeof raw.sources !== 'object' || Array.isArray(raw.sources)) throw safeFailure('state_invalid');
  const sources = {};
  for (const name of Object.keys(raw.sources)) {
    const item = raw.sources[name];
    if (!SOURCES.includes(name) || !iso(item?.attemptedAt) || Date.parse(item.attemptedAt) > now + 300000 || !['updated', 'unchanged', 'failed'].includes(item.status) || !['ok', 'update_failed', 'validation_failed', 'source_delayed'].includes(item.code) || item.code === 'source_delayed' && (item.status === 'failed' || !['quotes', 'horoscope'].includes(name)) || item.lastSuccessAt != null && (!iso(item.lastSuccessAt) || Date.parse(item.lastSuccessAt) > Date.parse(item.attemptedAt))) throw safeFailure('state_invalid');
    if (item.attemptedSlot !== undefined && !['morning', 'evening', 'recovery', 'hourly'].includes(item.attemptedSlot)) throw safeFailure('state_invalid');
    sources[name] = { attemptedAt: item.attemptedAt, status: item.status, code: item.code, ...(item.lastSuccessAt ? { lastSuccessAt: item.lastSuccessAt } : {}),
      ...(item.attemptedSlot !== undefined ? { attemptedSlot: item.attemptedSlot } : {}) };
  }
  return { version: 1, sources };
}
async function optionalJson(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function atomicWrite(file, data) { const temp = `${file}.tmp`; await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`); await rename(temp, file); }
export async function runSource(source, { root, directory, deadline }) {
  try {
    // Never forward child stdout/stderr, URLs, arbitrary exceptions or authenticated bodies.
    const env = { ...process.env, DAILYINFO_DATA_DIR: directory };
    if (source !== 'earthquakes') delete env.CWA_API_KEY;
    const timeout = deadline == null ? 210000 : Math.min(210000, deadline - nowMs());
    if (!Number.isFinite(timeout) || timeout <= 0) throw Error();
    await runFile(process.execPath, [join(root, 'scripts', `update-${source}.mjs`)], { cwd: root, env, timeout, maxBuffer: 1048576, windowsHide: true });
  } catch (error) { throw safeFailure('update_failed'); }
}
export async function updateData({ root = PROJECT_ROOT, sources = SOURCES, scheduled = false, cron, now = nowMs, runner = runSource, deadline, startBy } = {}) {
  if (startBy != null && (!Number.isFinite(startBy) || now() > startBy)) throw safeFailure('acceptance_expired');
  if (deadline != null && (!Number.isFinite(deadline) || now() >= deadline)) throw safeFailure('acceptance_expired');
  if (!sources.length || new Set(sources).size !== sources.length || sources.some(name => !SOURCES.includes(name))) throw safeFailure('unknown_source');
  if (scheduled) scheduleDecision(sources[0], { sources: {} }, now(), { cron });
  const base = resolve(root, '.cache/data-updates'); await mkdir(base, { recursive: true });
  const lock = join(base, 'lock');
  try { await mkdir(lock); } catch { throw safeFailure('update_locked'); }
  let staging, sourceStarted = false;
  try {
    const statePath = join(base, 'status.json');
    const old = await optionalJson(statePath), state = old ? validateState(old, now()) : { version: 1, sources: {} };
    staging = await mkdtemp(join(base, 'run-'));
    const results = [], startedAt = isoInstant(now());
    for (const source of sources) {
      if (deadline != null && now() >= deadline) throw safeFailure('acceptance_expired');
      const target = join(root, 'public/data', `${source}.json`), directory = join(staging, source);
      let previous, attemptedSlot;
      const oldSuccess = state.sources[source]?.lastSuccessAt;
      const details = data => ({ lastSuccessAt: state.sources[source]?.lastSuccessAt ?? null, sourceDate: data ? sourceDate(source, data) : null, fetchedAt: data?.fetchedAt ?? null,
        retry: scheduleDecision(source, state, now(), { cron: scheduled ? cron : undefined }) });
      try {
        try {
          const raw = await optionalJson(target); previous = raw ? validateData(source, raw, now()) : null;
        } catch (error) { throw error; }
        const due = scheduleDecision(source, state, now(), { cron: scheduled ? cron : undefined });
        if (scheduled && !due.due) { results.push({ source, status: 'skipped', code: 'not_due', ...details(previous) }); continue; }
        if (scheduled) attemptedSlot = due.slot;
        await mkdir(directory);
        if (previous) await copyFile(target, join(directory, `${source}.json`));
        if (!sourceStarted && startBy != null && now() > startBy) throw safeFailure('acceptance_expired');
        sourceStarted = true;
        try { await runner(source, { root, directory, ...(deadline != null ? { deadline } : {}) }); } catch (error) { throw safeFailure('update_failed'); }
        if (deadline != null && now() >= deadline) throw safeFailure('acceptance_expired');
        const rawNext = await optionalJson(join(directory, `${source}.json`));
        const next = validateData(source, rawNext, now());
        if (previous && compareSnapshots(source, next, previous) < 0) throw safeFailure('validation_failed');
        if (source === 'horoscope' && next.readings[0].date !== taipeiDate(now())) throw safeFailure('source_delayed');
        const delayed = source === 'quotes' && next.tradeDate < taipeiDate(now());
        const changed = !previous || contentDigest(previous) !== contentDigest(next);
        if (changed) { await mkdir(join(root, 'public/data'), { recursive: true }); rawNext.updatedAt = isoInstant(now()); validateData(source, rawNext, now()); await atomicWrite(target, rawNext); }
        const item = { attemptedAt: startedAt, status: changed ? 'updated' : 'unchanged', code: delayed ? 'source_delayed' : 'ok',
          ...(attemptedSlot ? { attemptedSlot } : {}),
          ...(!delayed ? { lastSuccessAt: startedAt } : oldSuccess ? { lastSuccessAt: oldSuccess } : {}) };
        state.sources[source] = item;
        const accepted = changed ? next : previous;
        results.push({ source, ...item, ...details(accepted) });
      } catch (error) {
        if (error.safeCode === 'acceptance_expired' || deadline != null && now() >= deadline) throw safeFailure('acceptance_expired');
        const code = ['update_failed', 'source_delayed'].includes(error.safeCode) ? error.safeCode : 'validation_failed';
        const item = { attemptedAt: startedAt, status: code === 'source_delayed' ? 'unchanged' : 'failed', code, ...(oldSuccess ? { lastSuccessAt: oldSuccess } : {}),
          ...(attemptedSlot ? { attemptedSlot } : {}) };
        state.sources[source] = item; results.push({ source, ...item, ...details(previous) });
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
export async function verifySnapshots(root = PROJECT_ROOT, now = nowMs()) {
  for (const source of SOURCES) validateData(source, await optionalJson(join(root, 'public/data', `${source}.json`)), now);
  await verifyPublicTree(join(root, 'public'));
}

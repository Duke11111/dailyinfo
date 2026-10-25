import { readFile, writeFile, mkdir, rename, rmdir } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SOURCES, validateData } from './data-automation.mjs';
import { restoreState } from './update-state.mjs';
import { selectCheckpoint } from './checkpoint-policy.mjs';
import { compareSnapshots, snapshotSourceDate } from '../../src/lib/snapshot-freshness.js';
import { nowMs } from '../../src/lib/time.js';
const exec = promisify(execFile);
const repository = 'Duke11111/dailyinfo';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = message => Object.assign(Error(message), { code: 'BASELINE_INVALID' });
export async function mergeLocalBaseline(root, directory, now = nowMs()) {
  const lock = join(root, '.cache/data-updates/lock');
  await mkdir(join(root, '.cache/data-updates'), { recursive: true });
  await mkdir(lock); // Shared with the updater; never remove another process's lock.
  try {
  const choices = [];
  // Validate every candidate and existing file before writing any accepted snapshot.
  for (const source of SOURCES) {
    const bytes = await readFile(join(directory, source + '.json'));
    const data = validateData(source, JSON.parse(bytes), now);
    let old;
    try { old = validateData(source, JSON.parse(await readFile(join(root, 'public/data', source + '.json'))), now); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    choices.push({ source, bytes, data, accept: !old || compareSnapshots(source, data, old) > 0 });
  }
  await mkdir(join(root, 'public/data'), { recursive: true });
  for (const item of choices.filter(item => item.accept)) {
    const target = join(root, 'public/data', item.source + '.json'), temporary = target + '.tmp';
    await writeFile(temporary, item.bytes); await rename(temporary, target);
  }
  return choices.map(item => ({ source: item.source, accepted: item.accept }));
  } finally { await rmdir(lock); }
}
export async function downloadLatestCheckpoint(root) {
  const gh = async args => (await exec('gh', args, { cwd: root, timeout: 30000, maxBuffer: 24 * 1024 * 1024, encoding: 'buffer', windowsHide: true })).stdout;
  const listing = JSON.parse(await gh(['api', `repos/${repository}/actions/artifacts?name=dailyinfo-data-state&per_page=100`]));
  const selected = await selectCheckpoint(listing.artifacts, async id => JSON.parse(await gh(['api', `repos/${repository}/actions/runs/${id}`])), { branch: 'main' });
  if (!selected || !/^sha256:[a-f0-9]{64}$/.test(selected.digest ?? '')) throw invalid('No verified unexpired checkpoint');
  if (selected.workflow_run.head_sha !== selected.verifiedHeadSha) throw invalid('Checkpoint source mismatch');
  const jobs = JSON.parse(await gh(['api', `repos/${repository}/actions/runs/${selected.workflow_run.id}/jobs?per_page=100`]));
  if (!jobs.jobs.some(job => job.name === 'checkpoint' && job.conclusion === 'success')) throw invalid('Checkpoint job not successful');
  const zip = await gh(['api', `repos/${repository}/actions/artifacts/${selected.id}/zip`]);
  return materializeCheckpoint(root, { runId: selected.workflow_run.id, artifactId: selected.id, expiresAt: selected.expires_at, digest: selected.digest, commit: selected.verifiedHeadSha }, zip);
}
export async function materializeCheckpoint(root, metadata, zip) {
  if (!(Date.parse(metadata.expiresAt) > nowMs()) || !/^[a-f0-9]{40}$/.test(metadata.commit ?? '')
    || !/^sha256:[a-f0-9]{64}$/.test(metadata.digest ?? '') || 'sha256:' + hash(zip) !== metadata.digest) throw invalid('Checkpoint expired or artifact digest invalid');
  const directory = join(root, '.cache/local-baseline', randomUUID()), archive = join(directory, 'artifact.zip'), extracted = join(directory, 'archive'), validated = join(directory, 'validated');
  await mkdir(extracted, { recursive: true }); await writeFile(archive, zip);
  // Fixed allowlist prevents path traversal, duplicate entries, and unrelated files.
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead(${quote(archive)}); try { $expected=@('quotes.json','news.json','earthquakes.json','horoscope.json','status.json','manifest.json'); if($z.Entries.Count -ne 6){throw 'entry_count'}; $seen=@{}; foreach($e in $z.Entries){ if($e.FullName -notin $expected -or $seen.ContainsKey($e.FullName) -or $e.Length -gt 2097152){throw 'invalid_entry'}; $seen[$e.FullName]=$true; [IO.Compression.ZipFileExtensions]::ExtractToFile($e,[IO.Path]::Combine(${quote(extracted)},$e.FullName),$false) } } finally { $z.Dispose() }`;
  try {
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 30000 });
  // Reuse the strict manifest, raw SHA-256, schema and commit verification.
    await restoreState(validated, extracted, nowMs(), { exact: true, expectedCommit: metadata.commit });
  } catch { throw invalid('Checkpoint archive, manifest or schema invalid'); }
  return { ...metadata, directory: join(validated, 'public/data') };
}
export async function revalidateCachedCheckpoint(root, metadata) {
  const archive = resolve(metadata.directory, '../../../artifact.zip');
  const scoped = relative(resolve(root, '.cache/local-baseline'), archive);
  if (scoped === '..' || scoped.startsWith('..' + sep) || scoped.startsWith(sep) || /^[A-Za-z]:/.test(scoped)) throw invalid('Cached checkpoint path invalid');
  return materializeCheckpoint(root, metadata, await readFile(archive));
}
export async function baselineFacts(root) {
  const facts = {};
  for (const source of SOURCES) {
    const bytes = await readFile(join(root, 'public/data', source + '.json'));
    const data = validateData(source, JSON.parse(bytes));
    facts[source] = { sourceDate: snapshotSourceDate(source, data), fetchedAt: data.fetchedAt, sha256: hash(bytes) };
  }
  return facts;
}

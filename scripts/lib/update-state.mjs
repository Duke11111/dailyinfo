import { readFile, writeFile, readdir, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SOURCES, validateData, validateState, assertPublicSafe, sourceDate } from './data-automation.mjs';
import { validateLegacySnapshot, stripLegacyState } from './legacy-checkpoint.mjs';
const names = [...SOURCES.map(source => `${source}.json`), 'status.json'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function exportState(root, directory, commit = '') {
  if (commit && !/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid commit');
  const files = {};
  for (const name of names) {
    const path = name === 'status.json' ? join(root, '.cache/data-updates/status.json') : join(root, 'public/data', name);
    const text = await readFile(path, 'utf8'); assertPublicSafe(text);
    if (name === 'status.json') validateState(JSON.parse(text)); else validateData(name.slice(0, -5), JSON.parse(text));
    files[name] = text;
  }
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).some(name => ![...names, 'manifest.json'].includes(name))) throw Error('Export directory contains unrelated state');
  for (const [name, text] of Object.entries(files)) await writeFile(join(directory, name), text);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version: 2, commit, hashes: Object.fromEntries(names.map(name => [name, digest(files[name])])) }));
}
export async function restoreState(root, directory, now = Date.now(), { exact = false, expectedCommit } = {}) {
  const entries = await readdir(directory);
  const legacy = entries.includes('exchange.json');
  const expectedNames = legacy ? [...names, 'exchange.json'] : names;
  if (entries.length !== expectedNames.length + 1 || entries.some(name => ![...expectedNames, 'manifest.json'].includes(name))) throw Error('State file list invalid');
  for (const name of entries) if (!(await lstat(join(directory, name))).isFile()) throw Error('State entry invalid');
  const manifestText = await readFile(join(directory, 'manifest.json'), 'utf8'); assertPublicSafe(manifestText);
  const manifest = JSON.parse(manifestText);
  if (manifest.version !== (legacy ? 1 : 2) || typeof manifest.commit !== 'string' || manifest.commit && !/^[a-f0-9]{40}$/.test(manifest.commit) || !manifest.hashes
    || Object.keys(manifest.hashes).sort().join(',') !== [...expectedNames].sort().join(',')) throw Error('State manifest invalid');
  if (exact && !/^[a-f0-9]{40}$/.test(manifest.commit) || expectedCommit && manifest.commit !== expectedCommit) throw Error('State approval invalid');
  const incoming = {};
  for (const name of expectedNames) {
    const text = await readFile(join(directory, name), 'utf8'); assertPublicSafe(text);
    if (digest(text) !== manifest.hashes[name]) throw Error('State checksum mismatch');
    const raw = JSON.parse(text);
    if (name === 'exchange.json') { validateLegacySnapshot(raw, now); continue; }
    if (name === 'status.json') { incoming[name] = JSON.stringify(validateState(legacy ? stripLegacyState(raw, now) : raw, now)); continue; }
    const source = name.slice(0, -5), data = validateData(source, raw, now);
    if (exact) { incoming[name] = text; continue; }
    let previous;
    try { previous = validateData(source, JSON.parse(await readFile(join(root, 'public/data', name), 'utf8')), now); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // A manually committed fresher snapshot always wins over the older CI checkpoint.
    if (!previous || sourceDate(source, data) >= sourceDate(source, previous) && Date.parse(data.fetchedAt) >= Date.parse(previous.fetchedAt)) incoming[name] = text;
  }
  // No writes until every file and checksum has passed.
  await mkdir(join(root, '.cache/data-updates'), { recursive: true });
  await mkdir(join(root, 'public/data'), { recursive: true });
  for (const [name, text] of Object.entries(incoming)) await writeFile(name === 'status.json' ? join(root, '.cache/data-updates/status.json') : join(root, 'public/data', name), text);
  return { ...manifest, migrated: legacy };
}

import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { assertPublicSafe } from './data-automation.mjs';

export const DEPLOY_BASE = '/dailyinfo/';
export function assertPublishableText(text) {
  assertPublicSafe(text, []);
  if (/[A-Z]:[\\/]+Users[\\/]+[A-Za-z0-9._-]+[\\/]|\/(?:Users|home)\/[A-Za-z0-9._-]+\//i.test(text)
    || /\b[A-Z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo|icloud|protonmail)\.[A-Z.]+\b/i.test(text)
    || /-----BEGIN (?:OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b/.test(text)) throw Error('private_content');
}
export async function verifyPublishedPrivacy(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) await verifyPublishedPrivacy(file);
    else if (!/\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|eot)$/i.test(file)) assertPublishableText(await readFile(file, 'utf8'));
  }
}
export function builtAssetPath(url, root) {
  if (!url.startsWith(DEPLOY_BASE) || /[?#\\]/.test(url)) throw Error('invalid_asset_base');
  const file = resolve(root, decodeURIComponent(url.slice(DEPLOY_BASE.length)));
  if (!file.startsWith(resolve(root) + sep)) throw Error('invalid_asset_path');
  return file;
}
export async function verifyBuiltPaths(root) {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(x => x[1]).filter(x => !x.startsWith('#'));
  if (urls.length < 3) throw Error('missing_built_assets');
  for (const url of urls) if (!(await stat(builtAssetPath(url, root))).isFile()) throw Error('missing_built_asset');
  const assets = await readdir(join(root, 'assets'));
  const js = (await Promise.all(assets.filter(x => x.endsWith('.js')).map(x => readFile(join(root, 'assets', x), 'utf8')))).join('\n');
  for (const name of ['stocks', 'quotes', 'news', 'earthquakes', 'exchange', 'horoscope']) {
    if (!js.includes(`${DEPLOY_BASE}data/${name}.json`)) throw Error('invalid_snapshot_base');
    if (await readFile(join(root, 'data', `${name}.json`), 'utf8') !== await readFile(resolve(root, '../public/data', `${name}.json`), 'utf8')) throw Error('snapshot_differs');
  }
  for (const name of assets.filter(x => x.endsWith('.css'))) {
    const css = await readFile(join(root, 'assets', name), 'utf8');
    for (const [, raw] of css.matchAll(/url\(([^)]+)\)/g)) {
      const url = raw.replace(/^["']|["']$/g, '');
      if (/^(?:data:|https:\/\/|#)/.test(url)) continue;
      if (!(await stat(builtAssetPath(url, root))).isFile()) throw Error('missing_css_asset');
    }
  }
  return { base: DEPLOY_BASE, htmlAssets: urls.length, snapshots: 6 };
}

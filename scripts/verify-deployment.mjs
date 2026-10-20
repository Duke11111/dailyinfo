import { resolve } from 'node:path';
import { verifySnapshots, verifyPublicTree } from './lib/data-automation.mjs';
import { verifyPublishedPrivacy, verifyBuiltPaths } from './lib/deployment-check.mjs';

try {
  // Offline only. Does not load .env files or run any source update script.
  await verifySnapshots();
  await verifyPublishedPrivacy(resolve('public'));
  if (process.argv.includes('--dist')) {
    await verifyPublicTree(resolve('dist'), []);
    await verifyPublishedPrivacy(resolve('dist'));
    console.log(JSON.stringify(await verifyBuiltPaths(resolve('dist'))));
  }
  console.log('Offline snapshot, privacy and deployment checks passed.');
} catch {
  console.error('Deployment verification failed; details suppressed to protect private data.');
  process.exitCode = 1;
}

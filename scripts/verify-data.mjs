import { resolve } from 'node:path';
import { verifySnapshots, verifyPublicTree } from './lib/data-automation.mjs';
try {
  await verifySnapshots();
  if (process.argv.includes('--dist')) await verifyPublicTree(resolve('dist'));
  console.log('Snapshot validation and public secret checks passed.');
} catch { console.error('Snapshot or public-file verification failed. Details suppressed to protect credentials.'); process.exitCode = 1; }

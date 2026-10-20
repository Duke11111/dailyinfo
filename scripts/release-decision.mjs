import { appendFile } from 'node:fs/promises';
import { releaseDecision } from './lib/release-policy.mjs';
const decision = releaseDecision(process.env);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(decision).map(([key, value]) => `${key}=${value}\n`).join(''));

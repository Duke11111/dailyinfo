import { appendFile } from 'node:fs/promises';
import { selectUpdateSources, updateData } from './lib/data-automation.mjs';
try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--scheduled' && !arg.startsWith('--sources='))) throw Error('Invalid arguments');
  const selected = args.find(arg => arg.startsWith('--sources='));
  const scheduled = args.includes('--scheduled');
  const report = await updateData({ sources: selectUpdateSources(selected ? selected.slice(10) : 'all', scheduled), scheduled });
  console.log(JSON.stringify(report, null, 2)); // Only allowlisted fields and controlled error codes.
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${report.changed}\nfailed=${report.failed}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## DailyInfo update\n\n${report.results.map(item => `- ${item.source}: ${item.status} (${item.code})`).join('\n')}\n`);
  if (report.failed) process.exitCode = 2; // Valid sources already saved; CI explicitly handles partial failures.
} catch { console.error('Data update stopped: lock, state, arguments or filesystem invalid. No raw errors are logged.'); process.exitCode = 1; }

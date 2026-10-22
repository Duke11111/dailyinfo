import { defineConfig } from 'vite';

export default defineConfig({
  base: '/dailyinfo/',
  // Avoid Windows worker contention; retain the tests' original VM deadlines.
  test: { maxWorkers: process.platform === 'win32' ? 2 : undefined },
});

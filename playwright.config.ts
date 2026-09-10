import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 5_000 },
  outputDir: '/tmp/treefold-playwright-results',
  reporter: 'list',
  projects: [
    { name: 'desktop', testMatch: 'desktop/*.test.ts' },
    { name: 'ui', testMatch: 'ui/*.spec.ts' },
    { name: 'electron', testMatch: 'electron/*.test.ts' },
  ],
});

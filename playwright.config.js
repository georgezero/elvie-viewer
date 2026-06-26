import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './tests/browser',
  outputDir: './test-artifacts/playwright-results',
  snapshotDir: './test-artifacts/snapshots',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'test-artifacts/playwright-report', open: 'never' }]],

  use: {
    baseURL: 'http://localhost:4173',
    screenshot: 'only-on-failure',
    trace: 'off',
    headless: true,
    viewport: { width: 1400, height: 900 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'python3 -m http.server 4173',
    cwd: path.join(__dirname, 'web'),
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 10_000,
  },
});

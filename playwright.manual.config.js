// Playwright config for manual/dev tests that require network access or headed mode.
//
// Run:
//   HYPERFRAMES_EXTERNAL=1 npx playwright test tests/manual/ --config=playwright.manual.config.js --headed
//
// NOT included in the normal CI test run (testDir in playwright.config.js is ./tests/browser).

import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './tests/manual',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    viewport: { width: 1400, height: 900 },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'python3 -m http.server 4173',
    cwd: path.join(__dirname, 'web'),
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 10_000,
  },
});

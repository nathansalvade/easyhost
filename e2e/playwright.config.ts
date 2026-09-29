import { defineConfig, devices } from '@playwright/test';
import { E2E_PORT } from './env.mjs';

// Runs against the built app: `npm run build` first.
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    ...devices['Desktop Chrome'],
    // Lets a machine reuse an installed Chromium instead of downloading one.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
  },
  webServer: {
    command: 'node e2e/server.mjs',
    cwd: '..',
    url: `http://127.0.0.1:${E2E_PORT}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

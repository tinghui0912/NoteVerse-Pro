import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.INTEGRATION_BASE_URL;
if (!baseURL) {
  throw new Error('INTEGRATION_BASE_URL is required.');
}

export default defineConfig({
  testDir: './tests/integration',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: devices['Desktop Chrome'],
    },
  ],
});

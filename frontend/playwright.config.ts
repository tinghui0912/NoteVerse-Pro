import { defineConfig, devices } from '@playwright/test';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

const port = 9002;
const host = 'localhost';
const baseURL = `http://${host}:${port}`;
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => {
    return typeof entry[1] === 'string';
  })
);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  timeout: 90_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command:
      `node ./node_modules/next/dist/bin/next dev --webpack -H ${host} -p ${port}`,
    url: `${baseURL}/en/auth/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...inheritedEnvironment,
      NEXT_BACKEND_ORIGIN: requiredEnv('NEXT_BACKEND_ORIGIN'),
      AUTH_COOKIE_NAME: requiredEnv('AUTH_COOKIE_NAME'),
      REFRESH_COOKIE_NAME: requiredEnv('REFRESH_COOKIE_NAME'),
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.CI ? undefined : 'chrome',
      },
    },
  ],
});

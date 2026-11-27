import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const customerServer = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer;
if (!customerServer) throw new Error('Customer production server is required');

export default defineConfig({
  ...base,
  testDir: './tests/security-e2e',
  retries: 0,
  webServer: [
    {
      ...customerServer,
      env: {
        ...process.env,
        NEXT_BACKEND_ORIGIN: 'http://127.0.0.1:8000',
        CSP_OBJECT_STORAGE_ORIGINS: 'https://objects.example.test',
      },
    },
    {
      cwd: '../platform-admin',
      command: 'node ./node_modules/next/dist/bin/next start -H localhost -p 3001',
      url: 'http://localhost:3001/login',
      reuseExistingServer: false,
      timeout: 120000,
      env: { ...process.env, NEXT_CONTROL_PLANE_ORIGIN: 'http://127.0.0.1:8002' },
    },
  ],
});

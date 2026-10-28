import { defineConfig } from '@playwright/test';

/**
 * E2E runs against the dev stack (`npm run dev:db`, `npm run seed`, `npm run dev`) with the mock payment and SMS
 * providers. It creates real orders in the dev database.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    geolocation: { latitude: 12.9389, longitude: 77.6268 },
    permissions: ['geolocation'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    cwd: '../..',
  },
});

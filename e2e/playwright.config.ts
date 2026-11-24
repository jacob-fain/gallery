import { defineConfig, devices } from '@playwright/test';

// Smoke tests against the production images behind TLS (compose.yml).
//   npm ci && npx playwright install chromium
//   npm test                      starts the stack, runs, tears it down
//   E2E_KEEP_STACK=1 npm test     leaves the stack up for another run
// E2E_PORT (default 8443) is the local https port; E2E_PROJECT names the
// compose project (default gallery-e2e).
const port = process.env.E2E_PORT ?? '8443';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `https://gallery.localhost:${port}`,
    // The stack's certificate is self-signed.
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    launchOptions: {
      // *.localhost already resolves to loopback. Signed S3 URLs name
      // s3.e2e.amazonaws.com on the default port, which this sends to the
      // TLS front.
      args: [`--host-resolver-rules=MAP s3.e2e.amazonaws.com 127.0.0.1:${port}`],
    },
  },
  projects: [
    { name: 'sign-in', testMatch: /\.setup\.ts$/, teardown: 'sign-out' },
    { name: 'smoke', dependencies: ['sign-in'] },
    { name: 'sign-out', testMatch: /\.teardown\.ts$/ },
  ],
});

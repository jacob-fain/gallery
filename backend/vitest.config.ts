import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Unit tests never reach a database: db.ts only needs a URL to build its
    // pool. Database-backed suites run only when TEST_DATABASE_URL is set,
    // and the setup rebuilds that database's schema with the migration runner.
    globalSetup: ['./test/dbSetup.ts'],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://unit:unit@127.0.0.1:1/unit',
      JWT_SECRET: 'unit-test-secret-that-is-at-least-32-characters',
      // Request and error lines would drown test output; logger tests set
      // their own level.
      LOG_LEVEL: 'silent',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // One-off operator scripts and the process entry point run outside the
      // request path, so counting them would only dilute the number.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/scripts/**', 'src/types/**'],
      reporter: ['text-summary', 'text', 'json-summary'],
    },
  },
});
